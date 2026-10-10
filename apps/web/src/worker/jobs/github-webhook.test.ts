import { describe, expect, it, vi } from 'vitest';
import { ActivityEvent, type ActivityEvent as Activity, type JobMessage } from '@hakit/contracts';
import { processGithubWebhook, type WebhookDependencies, type ActivityTransaction } from './github-webhook';
import { pushFixture, receivedAt, prFixture } from '../services/github/fixtures.test-data';

const project = '10000000-0000-4000-8000-000000000001';
const user = '20000000-0000-4000-8000-000000000001';
type Job = Extract<JobMessage, { type: 'github.webhook' }>;
const job: Job = { type: 'github.webhook', deliveryId: 'delivery-1', event: 'push', payload: pushFixture };

const task = '30000000-0000-4000-8000-000000000012';

function setup(projectIds = [project], tasks: Record<number, string> = {}) {
  let events: Activity[] = [];
  const processed = new Set<string>();
  const trace: string[] = [];
  const publish = vi.fn(async (event: Activity) => {
    expect(events.some((e) => e.id === event.id)).toBe(true);
    trace.push('publish');
  });
  const save = vi.fn(async (event: Activity) => {
    const existing = events.find((e) => e.id === event.id);
    if (existing) return existing;
    if (
      event.kind === 'commit' &&
      events.some((e) => e.kind === 'commit' && e.sha === event.sha && e.projectId === event.projectId)
    )
      return null;
    events.push(event);
    return event;
  });
  const tx: ActivityTransaction = {
    delivery: async (id) => ({ receivedAt, processed: processed.has(id) }),
    projects: async () => projectIds,
    byGithubId: async (id) => (id === 200 ? user : null),
    byAlias: async () => null,
    taskByNumber: vi.fn(async (_projectId: string, numbers: number[]) => {
      const n = numbers.find((number) => tasks[number]);
      return n === undefined ? null : tasks[n]!;
    }),
    save,
  };
  const deps: WebhookDependencies = {
    transaction: async (run) => {
      const previous = [...events];
      try {
        const result = await run(tx);
        trace.push('commit');
        return result;
      } catch (err) {
        events = previous;
        throw err;
      }
    },
    publish,
    requestLink: vi.fn(async () => {
      trace.push('link');
    }),
    markProcessed: vi.fn(async (id) => {
      processed.add(id);
      trace.push('processed');
    }),
  };
  return { deps, tx, publish, save, processed, trace, rows: () => events };
}

describe('GitHub webhook processing', () => {
  it('attributes and stores schema-valid activity before broadcasting', async () => {
    const s = setup();
    await processGithubWebhook(job, s.deps);
    expect(s.rows()).toHaveLength(1);
    expect(ActivityEvent.safeParse(s.rows()[0]).success).toBe(true);
    expect(s.rows()[0]).toMatchObject({ actorUserId: user, projectId: project });
    expect(s.trace).toEqual(['commit', 'publish', 'link', 'processed']);
  });
  it('does not repeat completed deliveries', async () => {
    const s = setup();
    await processGithubWebhook(job, s.deps);
    await processGithubWebhook(job, s.deps);
    expect(s.rows()).toHaveLength(1);
    expect(s.publish).toHaveBeenCalledTimes(1);
  });
  it('deduplicates commits across delivery IDs even with different timestamps', async () => {
    const s = setup();
    await processGithubWebhook(job, s.deps);
    await processGithubWebhook(
      {
        ...job,
        deliveryId: 'delivery-2',
        payload: {
          ...pushFixture,
          commits: [{ ...pushFixture.commits[0], timestamp: receivedAt }],
        },
      },
      s.deps,
    );
    expect(s.rows()).toHaveLength(1);
    expect(s.publish).toHaveBeenCalledTimes(1);
    expect(s.processed.has('delivery-2')).toBe(true);
  });
  it('fans out to connected projects with distinct event IDs', async () => {
    const s = setup([project, '10000000-0000-4000-8000-000000000002']);
    await processGithubWebhook(job, s.deps);
    expect(new Set(s.rows().map((e) => e.id)).size).toBe(2);
    expect(s.publish).toHaveBeenCalledTimes(2);
  });
  it('does not leak activity to projects without a repo connection', async () => {
    const s = setup([]);
    await processGithubWebhook(job, s.deps);
    expect(s.rows()).toEqual([]);
    expect(s.publish).not.toHaveBeenCalled();
  });
  it('retries failed broadcasts without inserting duplicate rows', async () => {
    const s = setup();
    s.publish.mockRejectedValueOnce(new Error('room unavailable'));
    await expect(processGithubWebhook(job, s.deps)).rejects.toThrow('room unavailable');
    expect(s.processed.size).toBe(0);
    const id = s.rows()[0]!.id;
    await processGithubWebhook(job, s.deps);
    expect(s.rows()).toHaveLength(1);
    expect(s.rows()[0]!.id).toBe(id);
    expect(s.processed.has(job.deliveryId)).toBe(true);
  });
  it('rolls back persistence failures and never broadcasts uncommitted events', async () => {
    const s = setup();
    s.save.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(processGithubWebhook(job, s.deps)).rejects.toThrow('database unavailable');
    expect(s.publish).not.toHaveBeenCalled();
    expect(s.processed.size).toBe(0);
    await processGithubWebhook(job, s.deps);
    expect(s.rows()).toHaveLength(1);
  });
  it('does not mark malformed payloads complete or broadcast them', async () => {
    const s = setup();
    await expect(processGithubWebhook({ ...job, payload: {} }, s.deps)).rejects.toThrow();
    expect(s.processed.size).toBe(0);
    expect(s.publish).not.toHaveBeenCalled();
  });
  it('stores PRs and reviews rather than generating commits from the PR head SHA', async () => {
    const s = setup();
    await processGithubWebhook({ ...job, event: 'pull_request', payload: prFixture }, s.deps);
    expect(s.rows().map((e) => e.kind)).toEqual(['pr_opened']);
  });
  it('can retry a failed completion write using the same event ID', async () => {
    const s = setup();
    vi.mocked(s.deps.markProcessed).mockRejectedValueOnce(new Error('completion failed'));
    await expect(processGithubWebhook(job, s.deps)).rejects.toThrow('completion failed');
    await processGithubWebhook(job, s.deps);
    expect(s.rows()).toHaveLength(1);
    expect(s.processed.size).toBe(1);
  });
  it('confirms a link from the branch reference and skips inferred linking', async () => {
    const s = setup([project], { 12: task });
    await processGithubWebhook(job, s.deps);
    expect(s.rows()[0]).toMatchObject({ taskId: task, linkKind: 'confirmed', linkConfidence: null });
    expect(s.tx.taskByNumber).toHaveBeenCalledWith(project, [12]);
    expect(s.deps.requestLink).not.toHaveBeenCalled();
  });
  it('reads references from the full commit message and PR text', async () => {
    const s = setup([project], { 7: task });
    const payload = {
      ...pushFixture,
      ref: 'refs/heads/main',
      commits: [{ ...pushFixture.commits[0]!, message: 'Subject\n\nCloses HK-7' }],
    };
    await processGithubWebhook({ ...job, payload }, s.deps);
    expect(s.rows()[0]).toMatchObject({ taskId: task, linkKind: 'confirmed', title: 'Subject' });
    const pr = { ...prFixture, pull_request: { ...prFixture.pull_request, title: 'x', body: 'Fixes HK-7' } };
    await processGithubWebhook({ ...job, deliveryId: 'pr', event: 'pull_request', payload: pr }, s.deps);
    expect(s.rows()[1]).toMatchObject({ kind: 'pr_opened', taskId: task, linkKind: 'confirmed' });
  });
  it('queues inferred linking after broadcast when no referenced task exists', async () => {
    const s = setup();
    await processGithubWebhook(job, s.deps);
    expect(s.rows()[0]).toMatchObject({ taskId: null, linkKind: 'none' });
    expect(s.deps.requestLink).toHaveBeenCalledWith(s.rows()[0]);
  });
});
