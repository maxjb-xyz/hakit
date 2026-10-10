import { describe, expect, it, vi } from 'vitest';
import type { ActivityEvent as Activity } from '@hakit/contracts';
import { activity } from '@hakit/contracts/fixtures';
import type { LinkCandidate } from '@hakit/engine';
import { processActivityLink, type LinkDependencies } from './activity-link';

const unlinked: Activity = { ...activity[0]!, taskId: null, linkKind: 'none', linkConfidence: null };
const job = { type: 'activity.link' as const, eventId: unlinked.id, projectId: unlinked.projectId };
const taskA = '30000000-0000-4000-8000-00000000000a';
const taskB = '30000000-0000-4000-8000-00000000000b';

function setup(
  event: Activity | null = unlinked,
  repoPrivate: boolean | null = false,
  candidates: LinkCandidate[] = [
    { taskId: taskA, embedding: [1, 0], assigneeIds: [], active: false },
    { taskId: taskB, embedding: [0, 1], assigneeIds: [], active: false },
  ],
) {
  const deps = {
    load: vi.fn(async () => (event ? { event, repoPrivate } : null)),
    candidates: vi.fn(async () => candidates),
    embed: vi.fn(async () => [1, 0]),
    save: vi.fn(async (e: Activity, link: { taskId: string; confidence: number }) => ({
      ...e,
      taskId: link.taskId,
      linkKind: 'inferred' as const,
      linkConfidence: link.confidence,
    })),
    publish: vi.fn(async () => {}),
  } satisfies LinkDependencies;
  return deps;
}

describe('inferred activity linking job', () => {
  it('stores an inferred link with confidence and broadcasts after the write', async () => {
    const deps = setup();
    await processActivityLink(job, deps);
    expect(deps.embed).toHaveBeenCalledWith(`${unlinked.title}\n${unlinked.ref}`);
    expect(deps.save).toHaveBeenCalledWith(unlinked, { taskId: taskA, confidence: 1 });
    expect(deps.publish).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: taskA, linkKind: 'inferred', linkConfidence: 1 }),
    );
  });
  it('never sends private or unknown-visibility repository text to the embedding provider', async () => {
    for (const visibility of [true, null]) {
      const deps = setup(unlinked, visibility);
      await processActivityLink(job, deps);
      expect(deps.embed).not.toHaveBeenCalled();
      expect(deps.save).not.toHaveBeenCalled();
    }
  });
  it('leaves already linked or missing events untouched', async () => {
    for (const event of [{ ...unlinked, taskId: taskB, linkKind: 'confirmed' as const }, null]) {
      const deps = setup(event);
      await processActivityLink(job, deps);
      expect(deps.embed).not.toHaveBeenCalled();
      expect(deps.save).not.toHaveBeenCalled();
    }
  });
  it('skips the provider call when the project has no embedded open tasks', async () => {
    const deps = setup(unlinked, false, []);
    await processActivityLink(job, deps);
    expect(deps.embed).not.toHaveBeenCalled();
  });
  it('stores nothing when the match is ambiguous', async () => {
    const deps = setup(unlinked, false, [
      { taskId: taskA, embedding: [1, 0.1], assigneeIds: [], active: false },
      { taskId: taskB, embedding: [1, 0.12], assigneeIds: [], active: false },
    ]);
    await processActivityLink(job, deps);
    expect(deps.save).not.toHaveBeenCalled();
    expect(deps.publish).not.toHaveBeenCalled();
  });
  it('does not broadcast when a concurrent link won the conditional write', async () => {
    const deps = setup();
    deps.save.mockResolvedValueOnce(null as never);
    await processActivityLink(job, deps);
    expect(deps.publish).not.toHaveBeenCalled();
  });
});
