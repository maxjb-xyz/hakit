import { describe, expect, it, vi } from 'vitest';
import { ActivityEvent, type ActivityEvent as Activity, type JobMessage } from '@hakit/contracts';
import {
  backfillKey,
  processGithubBackfill,
  type BackfillDependencies,
  type BackfillTransaction,
  type ConnectedRepo,
} from './github-backfill';
import {
  GithubBackfillError,
  githubBackfillClient,
  normalizeBackfill,
  type BackfillSnapshot,
  type RestCommit,
  type RestPull,
} from '../services/github/backfill';

const project = '10000000-0000-4000-8000-000000000001';
const user = '20000000-0000-4000-8000-000000000001';
const task12 = '30000000-0000-4000-8000-000000000012';
const NOW = Date.parse('2026-10-10T12:00:00.000Z');
const SINCE = new Date(NOW - 48 * 3_600_000).toISOString();
type Job = Extract<JobMessage, { type: 'github.backfill' }>;
const job: Job = { type: 'github.backfill', projectId: project, repoId: 42, sinceHours: 48 };
const repo: ConnectedRepo = { id: 42, fullName: 'team/repo', defaultBranch: 'main', installationId: 7 };

const commit = (sha: string, date: string, message: string, extra: Partial<RestCommit> = {}): RestCommit => ({
  sha,
  html_url: `https://github.com/team/repo/commit/${sha}`,
  commit: { message, author: { name: 'Author', email: '200+author@users.noreply.github.com', date } },
  author: { id: 200, login: 'author' },
  ...extra,
});
const pull = (number: number, extra: Partial<RestPull> = {}): RestPull => ({
  number,
  title: `HK-${number}: feature`,
  body: null,
  html_url: `https://github.com/team/repo/pull/${number}`,
  user: { id: 200, login: 'author' },
  head: { ref: `hk-${number}-feature`, sha: 'f00' },
  created_at: '2026-10-10T08:00:00Z',
  updated_at: '2026-10-10T09:00:00Z',
  closed_at: null,
  merged_at: null,
  ...extra,
});

const snapshot: BackfillSnapshot = {
  repoId: 42,
  defaultBranch: 'main',
  branches: [
    { name: 'main', commit: { sha: 'm1' } },
    { name: 'hk-12-feature', commit: { sha: 'f2' } },
  ],
  commitsByBranch: {
    main: [
      commit('m1', '2026-10-10T07:00:00Z', 'Merge main work'),
      commit('old', '2026-10-01T07:00:00Z', 'Too old to backfill'),
    ],
    'hk-12-feature': [
      commit('f2', '2026-10-10T06:00:00Z', 'Second step'),
      commit('f1', '2026-10-10T05:00:00Z', 'First step\nbody'),
      // Also on main: attributed to main, never duplicated.
      commit('m1', '2026-10-10T07:00:00Z', 'Merge main work'),
    ],
  },
  pulls: [
    pull(12),
    pull(13, {
      created_at: '2026-09-01T00:00:00Z',
      merged_at: '2026-10-10T10:00:00Z',
      closed_at: '2026-10-10T10:00:00Z',
    }),
    pull(14, { closed_at: '2026-10-10T11:00:00Z' }),
  ],
};

describe('normalizeBackfill', () => {
  const rows = normalizeBackfill(snapshot, SINCE);
  const kinds = rows.map(
    (r) => `${r.activity.kind}:${r.activity.sha ?? r.activity.prNumber ?? r.activity.ref}`,
  );

  it('maps commits in the window once each, on the default branch first', () => {
    expect(kinds.filter((k) => k.startsWith('commit:')).sort()).toEqual([
      'commit:f1',
      'commit:f2',
      'commit:m1',
    ]);
    expect(rows.find((r) => r.activity.sha === 'm1')!.activity.ref).toBe('main');
    expect(rows.find((r) => r.activity.sha === 'f1')).toMatchObject({
      linkText: 'First step\nbody',
      activity: { title: 'First step', ts: '2026-10-10T05:00:00.000Z' },
      actor: { id: 200, login: 'author', email: '200+author@users.noreply.github.com' },
    });
  });
  it('creates one branch row per non-default branch at its earliest own commit', () => {
    const branches = rows.filter((r) => r.activity.kind === 'branch_created');
    expect(branches).toHaveLength(1);
    expect(branches[0]!.activity).toMatchObject({ ref: 'hk-12-feature', ts: '2026-10-10T05:00:00.000Z' });
  });
  it('maps PR opened, merged and closed only when they happened in the window', () => {
    expect(kinds).toContain('pr_opened:12');
    expect(kinds).toContain('pr_merged:13');
    expect(kinds).not.toContain('pr_opened:13');
    expect(kinds).not.toContain('pr_closed:13');
    expect(kinds).toContain('pr_closed:14');
  });
  it('orders rows oldest first', () => {
    const ts = rows.map((r) => Date.parse(r.activity.ts));
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
  });
});

function setup(existing: Activity[] = []) {
  const events: Activity[] = [...existing];
  const trace: string[] = [];
  const tx: BackfillTransaction = {
    byGithubId: async (id) => (id === 200 ? user : null),
    byAlias: async () => null,
    taskByNumber: async (_p, numbers) => (numbers.includes(12) ? task12 : null),
    hasEquivalent: async (e) =>
      events.some(
        (x) =>
          x.projectId === e.projectId &&
          x.kind === e.kind &&
          (e.kind === 'commit'
            ? x.sha === e.sha
            : e.prNumber !== null
              ? x.prNumber === e.prNumber
              : x.ref === e.ref),
      ),
    save: async (e) => {
      events.push(e);
      return e;
    },
  };
  const deps: BackfillDependencies = {
    connectedRepo: vi.fn(async () => repo),
    snapshot: vi.fn(async () => snapshot),
    transaction: async (run) => {
      const r = await run(tx);
      trace.push('commit');
      return r;
    },
    publish: vi.fn(async () => {
      trace.push('publish');
    }),
    requestLink: vi.fn(async () => {
      trace.push('link');
    }),
    now: () => NOW,
  };
  return { deps, events, trace };
}

describe('processGithubBackfill', () => {
  it('stores schema-valid, attributed, explicitly linked activity before broadcasting', async () => {
    const s = setup();
    const count = await processGithubBackfill(job, s.deps);
    expect(count).toBe(s.events.length);
    expect(s.events.every((e) => ActivityEvent.safeParse(e).success)).toBe(true);
    expect(s.events.every((e) => e.actorUserId === user && e.projectId === project)).toBe(true);
    expect(s.events.find((e) => e.kind === 'pr_opened' && e.prNumber === 12)).toMatchObject({
      taskId: task12,
      linkKind: 'confirmed',
    });
    expect(s.trace[0]).toBe('commit');
    expect(s.deps.snapshot).toHaveBeenCalledWith(repo, SINCE);
  });
  it('queues inferred linking only for rows without an explicit reference', async () => {
    const s = setup();
    await processGithubBackfill(job, s.deps);
    const unlinked = s.events.filter((e) => e.linkKind === 'none');
    expect(unlinked.length).toBeGreaterThan(0);
    expect(s.deps.requestLink).toHaveBeenCalledTimes(unlinked.length);
  });
  it('is idempotent: a second run stores and announces nothing', async () => {
    const s = setup();
    await processGithubBackfill(job, s.deps);
    const first = s.events.length;
    const count = await processGithubBackfill(job, s.deps);
    expect(count).toBe(0);
    expect(s.events).toHaveLength(first);
    expect(s.deps.publish).toHaveBeenCalledTimes(first);
  });
  it('skips commits, branches and PRs a webhook already recorded', async () => {
    const s = setup();
    await processGithubBackfill(job, s.deps);
    const webhookRows = s.events.map((e) => ({ ...e, id: crypto.randomUUID() }));
    const t = setup(webhookRows);
    expect(await processGithubBackfill(job, t.deps)).toBe(0);
  });
  it('derives stable IDs from natural keys', () => {
    const [row] = normalizeBackfill(snapshot, SINCE);
    expect(backfillKey(row!.activity)).toMatch(/^(commit|branch|pr_)/);
  });
  it('does nothing when the repo is no longer connected', async () => {
    const s = setup();
    s.deps.connectedRepo = async () => null;
    expect(await processGithubBackfill(job, s.deps)).toBe(0);
    expect(s.deps.snapshot).not.toHaveBeenCalled();
  });
  it('acks permanent GitHub failures and rethrows retryable ones', async () => {
    const s = setup();
    s.deps.snapshot = async () => {
      throw new GithubBackfillError('gone', false);
    };
    expect(await processGithubBackfill(job, s.deps)).toBe(0);
    s.deps.snapshot = async () => {
      throw new GithubBackfillError('rate limited');
    };
    await expect(processGithubBackfill(job, s.deps)).rejects.toThrow('rate limited');
  });
});

describe('githubBackfillClient', () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('exchanges the app JWT for an installation token', async () => {
    const fetcher = vi.fn(async () => json({ token: 'ghs_x' }));
    const token = await githubBackfillClient(fetcher as unknown as typeof fetch).installationToken('jwt', 7);
    expect(token).toBe('ghs_x');
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.github.com/app/installations/7/access_tokens');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('manual');
  });
  it('reads branches, per-branch commits since the window, and recently updated PRs', async () => {
    const urls: string[] = [];
    const fetcher = vi.fn(async (url: string) => {
      urls.push(url);
      if (url.includes('/branches')) return json(snapshot.branches);
      if (url.includes('/commits'))
        return json(url.includes('sha=main') ? snapshot.commitsByBranch.main : []);
      return json([pull(12), pull(9, { updated_at: '2026-09-01T00:00:00Z' })]);
    });
    const s = await githubBackfillClient(fetcher as unknown as typeof fetch).snapshot('t', repo, SINCE);
    expect(urls.every((u) => u.startsWith('https://api.github.com/repos/team/repo/'))).toBe(true);
    expect(urls.filter((u) => u.includes('/commits'))).toHaveLength(2);
    expect(urls.find((u) => u.includes('sha=main'))).toContain(`since=${encodeURIComponent(SINCE)}`);
    expect(s.pulls.map((p) => p.number)).toEqual([12]);
  });
  it('marks 404s permanent and other failures retryable', async () => {
    const gone = githubBackfillClient((async () => json({}, 404)) as unknown as typeof fetch);
    await expect(gone.installationToken('jwt', 7)).rejects.toMatchObject({ retryable: false });
    const busy = githubBackfillClient((async () => json({}, 403)) as unknown as typeof fetch);
    await expect(busy.installationToken('jwt', 7)).rejects.toMatchObject({ retryable: true });
  });
  it('rejects malformed responses', async () => {
    const bad = githubBackfillClient((async () => json([{ nope: 1 }])) as unknown as typeof fetch);
    await expect(bad.snapshot('t', repo, SINCE)).rejects.toBeInstanceOf(GithubBackfillError);
  });
});
