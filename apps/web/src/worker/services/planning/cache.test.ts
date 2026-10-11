import { describe, expect, it, vi } from 'vitest';
import { PlanStreamEvent } from '@hakit/contracts';
import { CASES } from '../ai/evals/cases';
import { pipelineInput } from '../ai/evals/harness';
import { scriptedPlanner, unavailable } from '../ai/evals/providers';
import { cachedPlanningInput, generateCachedPlan, planPromptHash } from './cache';
import type { LlmProvider } from '../ai/types';

function trackedPlanner() {
  const calls = vi.fn();
  const llm: LlmProvider = {
    name: scriptedPlanner.name,
    generateStructured(req) {
      calls();
      return scriptedPlanner.generateStructured(req);
    },
  };
  return { llm, calls };
}

describe('planning cache', () => {
  const options = { projectId: 'p1', model: 'test-model' };
  const input = () => pipelineInput(CASES[0]!);
  it('reuses a generated plan without another provider call and emits validated sections', async () => {
    const { llm, calls } = trackedPlanner();
    const first = await generateCachedPlan(input(), llm, async () => {}, {
      ...options,
      find: async () => undefined,
    });
    expect(first.promptHash).toMatch(/^[a-f0-9]{64}$/);
    calls.mockClear();
    const events: PlanStreamEvent[] = [];
    const second = await generateCachedPlan(
      input(),
      llm,
      async (e) => {
        events.push(PlanStreamEvent.parse(e));
      },
      { ...options, find: async () => first },
    );
    expect(calls).not.toHaveBeenCalled();
    expect(second.payload).toEqual(first.payload);
    expect(second.feasibility.ok).toBe(true);
    expect(events.some((e) => e.type === 'outline')).toBe(true);
    expect(events.some((e) => e.type === 'epic_tasks')).toBe(true);
    expect(events.some((e) => e.type === 'validation')).toBe(true);
  });
  it('separates projects, models, guidance, team levels, constraints and deadline facts', async () => {
    const base = input();
    const key = await planPromptHash(base, 'p1', 'model1');
    expect(await planPromptHash(base, 'p2', 'model1')).not.toBe(key);
    expect(await planPromptHash(base, 'p1', 'model2')).not.toBe(key);
    for (const mutate of [
      (c: typeof base) => {
        c.guidance = 'make it smaller';
      },
      (c: typeof base) => {
        c.validation.teamSkillLevels.set('react', 1);
      },
      (c: typeof base) => {
        c.context.constraints.requiredTech = ['Gemini'];
      },
      (c: typeof base) => {
        c.context.hackathon.endsAt = '2099-01-01T00:00:00Z';
      },
      (c: typeof base) => {
        c.idea.pitch = 'changed idea';
      },
    ]) {
      const changed = structuredClone(base);
      mutate(changed);
      expect(await planPromptHash(changed, 'p1', 'model1')).not.toBe(key);
    }
    const reordered = structuredClone(base);
    reordered.validation.teamSkillLevels = new Map([...base.validation.teamSkillLevels].reverse());
    reordered.validation.allowedSkillSlugs = new Set([...base.validation.allowedSkillSlugs].reverse());
    expect(await planPromptHash(reordered, 'p1', 'model1')).toBe(key);
  });
  it('uses conservative five-minute inputs while keeping the exact current validator facts', async () => {
    const a = input();
    a.context.hackathon.hoursRemaining = 23.99;
    a.eventElapsedHours = 1.01;
    const b = structuredClone(a);
    b.context.hackathon.hoursRemaining = 23.98;
    b.eventElapsedHours = 1.02;
    const normalized = cachedPlanningInput(a);
    expect(normalized.context.hackathon.hoursRemaining).toBeLessThanOrEqual(
      a.context.hackathon.hoursRemaining,
    );
    expect(normalized.eventElapsedHours).toBeLessThanOrEqual(a.eventElapsedHours);
    expect(normalized.validation).toBe(a.validation);
    expect(await planPromptHash(a, 'p', 'm')).toBe(await planPromptHash(b, 'p', 'm'));
    b.eventElapsedHours = 1.1;
    expect(await planPromptHash(a, 'p', 'm')).not.toBe(await planPromptHash(b, 'p', 'm'));
  });
  it('never caches template fallback and discards malformed cache rows', async () => {
    const result = await generateCachedPlan(input(), unavailable, async () => {}, {
      ...options,
      find: async () => ({ payload: {}, feasibility: {}, model: 'gemini' }),
    });
    expect(result.model).toBe('template');
    expect(result.promptHash).toBeNull();
  });
  it('rejects cached templates, cut-line drafts and another idea rather than masking recovery', async () => {
    const first = await generateCachedPlan(input(), scriptedPlanner, async () => {}, {
      ...options,
      find: async () => undefined,
    });
    for (const stored of [
      { ...first, model: 'template' },
      { ...first, feasibility: { ...first.feasibility, cutTaskKeys: ['cut-task'] } },
      { ...first, payload: { ...first.payload, idea: { ...first.payload.idea, pitch: 'wrong idea' } } },
    ]) {
      const { llm, calls } = trackedPlanner();
      await generateCachedPlan(input(), llm, async () => {}, { ...options, find: async () => stored });
      expect(calls).toHaveBeenCalled();
    }
  });
});
