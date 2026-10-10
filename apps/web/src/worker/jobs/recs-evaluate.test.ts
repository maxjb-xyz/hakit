import { describe, expect, it } from 'vitest';
import type { RecommendationDraft } from '@hakit/contracts';
import { handlers } from './index';
import { reconcileRecommendations, recsEvaluateJob } from './recs-evaluate';

const USER = '00000000-0000-4000-8000-000000000002';
const draft = (key: string, headline = 'Check in'): RecommendationDraft => ({
  kind: 'check_in',
  severity: 'info',
  dedupeKey: key,
  headline,
  rationale: 'quiet',
  impact: {},
  actions: [{ op: 'notify', userId: USER, message: 'hi' }],
  signals: [{ label: 'Threshold', value: '90 min' }],
});
const open = (id: string, d: RecommendationDraft) => ({ id, ...d });

describe('recs.evaluate reconciliation', () => {
  it('registers the real handler', () => {
    expect(handlers['recs.evaluate']).toBe(recsEvaluateJob);
  });

  it('creates new keys, leaves unchanged ones alone, updates changed ones and expires cleared ones', () => {
    const plan = reconcileRecommendations(
      [open('r1', draft('stall:a')), open('r2', draft('stall:b')), open('r3', draft('stall:c'))],
      [draft('stall:a'), draft('stall:b', 'Reassign'), draft('stall:d')],
      new Set(),
    );
    expect(plan.create.map((d) => d.dedupeKey)).toEqual(['stall:d']);
    expect(plan.update).toEqual([{ id: 'r2', draft: draft('stall:b', 'Reassign') }]);
    expect(plan.expire).toEqual(['r3']);
  });

  it('ignores jsonb key reordering and absent optional fields when comparing', () => {
    const stored = { ...draft('k'), impact: { hoursFreed: 2, criticalPathHoursSaved: 1 } };
    const reordered = { ...stored, impact: { criticalPathHoursSaved: 1, hoursFreed: 2 } };
    const plan = reconcileRecommendations(
      [open('r1', reordered)],
      [{ ...stored, impact: { ...stored.impact, tasksUnblocked: undefined } }],
      new Set(),
    );
    expect(plan).toEqual({ create: [], update: [], expire: [] });
  });

  it('does not re-raise a key a human recently accepted or dismissed', () => {
    expect(reconcileRecommendations([], [draft('stall:a')], new Set(['stall:a'])).create).toEqual([]);
  });

  it('is idempotent on unchanged state', () => {
    const drafts = [draft('stall:a')];
    const first = reconcileRecommendations([], drafts, new Set());
    const second = reconcileRecommendations(
      first.create.map((d, i) => open(`r${i}`, d)),
      drafts,
      new Set(),
    );
    expect(second).toEqual({ create: [], update: [], expire: [] });
  });
});
