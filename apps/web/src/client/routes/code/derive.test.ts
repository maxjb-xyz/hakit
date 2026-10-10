import { describe, expect, it } from 'vitest';
import type { ActivityEvent } from '@hakit/contracts';
import * as fx from '@hakit/contracts/fixtures';
import { NO_FILTERS, branches, filterFeed, pullRequests, unknownAuthors, unlinkedQueue } from './derive';

let n = 0;
const ev = (over: Partial<ActivityEvent>): ActivityEvent => ({
  ...fx.activity[0]!,
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  taskId: null,
  linkKind: 'none',
  linkConfidence: null,
  sha: null,
  prNumber: null,
  ...over,
});
const T = (h: number) => `2026-10-10T${String(h).padStart(2, '0')}:00:00Z`;

const events = [
  ev({
    kind: 'pr_opened',
    prNumber: 5,
    ref: 'hk-5-x',
    ts: T(8),
    title: 'Add x',
    actorUserId: null,
    actorRaw: 'jdoe',
  }),
  ev({ kind: 'pr_review', prNumber: 5, ref: 'hk-5-x', ts: T(9), title: 'PR #5 review: approved' }),
  ev({ kind: 'pr_review', prNumber: 5, ref: 'hk-5-x', ts: T(9), title: 'PR #5 review: changes_requested' }),
  ev({
    kind: 'pr_merged',
    prNumber: 5,
    ref: 'hk-5-x',
    ts: T(10),
    title: 'Add x',
    taskId: 't5',
    linkKind: 'confirmed',
  }),
  ev({ kind: 'commit', ref: 'hk-5-x', sha: 'abc', ts: T(7), actorUserId: null, actorRaw: 'jdoe' }),
  ev({
    kind: 'commit',
    ref: 'main',
    sha: 'def',
    ts: T(11),
    taskId: 't2',
    linkKind: 'inferred',
    linkConfidence: 0.6,
  }),
  ev({
    kind: 'commit',
    ref: 'wip',
    sha: 'ghi',
    ts: T(6),
    taskId: 't3',
    linkKind: 'inferred',
    linkConfidence: 0.9,
  }),
  ev({ kind: 'agent_active', source: 'agent', ts: T(12) }),
];

describe('code screen derivations', () => {
  it('summarizes PRs: state from lifecycle, reviews by state, confirmed link wins', () => {
    const [pr] = pullRequests(events);
    expect(pr).toMatchObject({
      number: 5,
      state: 'merged',
      approvals: 1,
      changesRequested: 1,
      reviews: 2,
      taskId: 't5',
      linkKind: 'confirmed',
      authorRaw: 'jdoe',
    });
  });
  it('lists non-default branches with last commit and PR state', () => {
    const rows = branches(events, 'main');
    expect(rows.map((b) => b.name)).toEqual(['hk-5-x', 'wip']);
    expect(rows[0]).toMatchObject({ lastCommitSha: 'abc', commits: 1, pr: { number: 5, state: 'merged' } });
    expect(rows[1]).toMatchObject({ linkKind: 'inferred', linkConfidence: 0.9 });
  });
  it('filters the feed to GitHub activity by member, type, task and link kind', () => {
    expect(filterFeed(events, NO_FILTERS)).toHaveLength(7);
    expect(filterFeed(events, { ...NO_FILTERS, member: 'unmapped' })).toHaveLength(2);
    expect(filterFeed(events, { ...NO_FILTERS, type: 'review' })).toHaveLength(2);
    expect(filterFeed(events, { ...NO_FILTERS, task: 't5' })).toHaveLength(1);
    expect(filterFeed(events, { ...NO_FILTERS, link: 'inferred' }).map((e) => e.sha)).toEqual(['def', 'ghi']);
  });
  it('queues inferred links first by confidence, then unlinked, minus ignored', () => {
    const q = unlinkedQueue(events, new Set());
    expect(q.slice(0, 2).map((e) => e.sha)).toEqual(['ghi', 'def']);
    expect(q.every((e) => e.linkKind !== 'confirmed' && e.source === 'github')).toBe(true);
    expect(unlinkedQueue(events, new Set([q[0]!.id]))).toHaveLength(q.length - 1);
  });
  it('groups unknown authors with commit counts', () => {
    expect(unknownAuthors(events)).toEqual([{ raw: 'jdoe', commits: 1, other: 1, lastAt: T(8) }]);
  });
});
