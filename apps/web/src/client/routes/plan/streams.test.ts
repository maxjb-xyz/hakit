import { describe, expect, it } from 'vitest';
import type { PlanStreamEvent } from '@hakit/contracts';
import { planDocument } from '@hakit/contracts/fixtures';
import { idleIdeaStream, idlePlanStream, ideaStreamReducer, planStreamReducer } from './streams';

const feasibility = {
  ok: true,
  requiredHours: 10,
  availableEffectiveHours: 20,
  criticalPathHours: 4,
  hoursUntilFinalMilestone: 30,
  cutTaskKeys: ['T9'],
  issues: [],
};

describe('plan stream reducer', () => {
  it('builds sections in arrival order and ends on done', () => {
    const events: PlanStreamEvent[] = [
      { type: 'stage', stage: 'outline', message: 'Drafting' },
      { type: 'outline', outline: planDocument.outline },
      { type: 'epic_tasks', epicKey: 'E1', tasks: planDocument.tasks },
      { type: 'validation', feasibility },
      { type: 'done', planId: 'p1' },
    ];
    const s = events.reduce(planStreamReducer, { ...idlePlanStream, running: true });
    expect(s).toMatchObject({ running: false, planId: 'p1', feasibility, error: null });
    expect(s.stages.map((x) => x.stage)).toEqual(['outline']);
    expect(s.tasksByEpic.E1).toHaveLength(1);
    expect(s.outline?.summary).toBe(planDocument.outline.summary);
  });

  it('stops on error and keeps what already streamed', () => {
    const s = [
      { type: 'outline', outline: planDocument.outline } as const,
      { type: 'error', code: 'X', message: 'down', fallbackAvailable: true } as const,
    ].reduce(planStreamReducer, { ...idlePlanStream, running: true });
    expect(s.running).toBe(false);
    expect(s.outline).not.toBeNull();
    expect(s.error).toEqual({ code: 'X', message: 'down', fallbackAvailable: true });
  });
});

describe('idea stream reducer', () => {
  it('replaces an idea with the same id (refine) instead of duplicating it', () => {
    const idea = {
      id: 'i1',
      projectId: 'p',
      source: 'ai' as const,
      teamFit: 0.5,
      selected: false,
      candidate: planDocument.idea,
      createdAt: '2026-10-10T00:00:00Z',
    };
    const s = [
      { type: 'stage', message: 'Reading' } as const,
      { type: 'idea', idea } as const,
      { type: 'idea', idea: { ...idea, teamFit: 0.9 } } as const,
      { type: 'done' } as const,
    ].reduce(ideaStreamReducer, { ...idleIdeaStream, running: true });
    expect(s.ideas.map((i) => i.teamFit)).toEqual([0.9]);
    expect(s).toMatchObject({ running: false, stage: null });
  });
});
