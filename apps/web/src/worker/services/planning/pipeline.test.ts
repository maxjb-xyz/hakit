import { describe, expect, it, vi } from 'vitest';
import {
  PlanDocument,
  PlanStreamEvent,
  type PlanOutline,
  type PlanningContext,
  type TaskDraft,
} from '@hakit/contracts';
import { planDocument } from '@hakit/contracts/fixtures';
import type { LlmProvider } from '../ai/types';
import { generatePlanPipeline, type PipelineInput } from './pipeline';
export function pipelineInput(): PipelineInput {
  const allowed = [...new Set(planDocument.tasks.flatMap((t) => t.requiredSkills.map((s) => s.slug)))];
  const context: PlanningContext = {
    team: {
      members: [
        {
          alias: 'M1',
          topSkills: allowed.map((slug) => ({ slug, level: 4, confidence: 1 })),
          learningGoals: [],
          avoid: [],
          availableHours: 50,
        },
      ],
      gaps: [],
      totalEffectiveHours: 100,
    },
    hackathon: {
      name: 'Test',
      endsAt: '2099-10-12T00:00:00Z',
      hoursRemaining: 48,
      judgingCriteria: [],
      tracks: [],
    },
    constraints: { challenges: [], requiredTech: [], excludedTech: [], custom: [] },
    taxonomy: { allowedSkillSlugs: allowed },
  };
  return {
    idea: planDocument.idea,
    context,
    validation: {
      allowedSkillSlugs: new Set(allowed),
      teamSize: 3,
      totalEffectiveHours: 100,
      hoursUntilDeadline: 48,
      selectedChallengeKeys: [],
      teamSkillLevels: new Map(allowed.map((s) => [s, 5])),
    },
  };
}
function provider(outline: PlanOutline, tasks: (epicKey: string) => TaskDraft[]): LlmProvider {
  return {
    name: 'gemini',
    generateStructured: async (req) =>
      req.schema.parse(
        req.task === 'plan.outline'
          ? outline
          : { tasks: tasks((req.input as { epic: { key: string } }).epic.key) },
      ),
  };
}
const outline = (count: number): PlanOutline => ({
  ...planDocument.outline,
  epics: Array.from({ length: count }, (_, i) => ({
    ...planDocument.outline.epics[0]!,
    key: `E${i + 1}`,
    challengeKeys: [],
  })),
});
const tasks = (epicKey: string): TaskDraft[] => [
  { ...planDocument.tasks[0]!, key: `${epicKey}-T1`, epicKey, estimateHours: 2, dependsOn: [] },
];
describe('plan pipeline', () => {
  it('limits concurrency to three, streams sections, injects deliverables, and validates', async () => {
    let active = 0,
      max = 0;
    const base = provider(outline(7), tasks);
    const llm: LlmProvider = {
      name: 'gemini',
      generateStructured: async (req) => {
        if (req.task === 'plan.tasks') {
          active++;
          max = Math.max(max, active);
          await new Promise((r) => setTimeout(r, 1));
          active--;
        }
        return base.generateStructured(req);
      },
    };
    const events: PlanStreamEvent[] = [];
    const result = await generatePlanPipeline(pipelineInput(), llm, async (e) => {
      events.push(e);
    });
    expect(max).toBe(3);
    expect(result.model).toBe('gemini');
    expect(PlanDocument.safeParse(result.payload).success).toBe(true);
    expect(events.every((e) => PlanStreamEvent.safeParse(e).success)).toBe(true);
    for (const title of [
      'Repo setup and deploy pipeline',
      'Demo script and video',
      'Devpost submission',
      'README',
    ])
      expect(result.payload.tasks.some((t) => t.title === title && t.priority === 'must')).toBe(true);
    expect(result.feasibility.issues.some((i) => i.code === 'MISSING_DELIVERABLE')).toBe(false);
  });
  it('uses a context-derived template when providers fail and retains the selected idea', async () => {
    const input = pipelineInput();
    input.idea = {
      ...input.idea,
      title: 'Custom project',
      pitch: 'A custom pitch',
      coreFeatures: ['Search content', 'Save results'],
    };
    const llm: LlmProvider = {
      name: 'gemini',
      generateStructured: async () => {
        throw new Error('unavailable');
      },
    };
    const result = await generatePlanPipeline(input, llm, async () => {});
    expect(result.model).toBe('template');
    expect(result.payload.idea.title).toBe('Custom project');
    expect(result.payload.tasks.some((t) => t.title === 'Search content')).toBe(true);
  });
  it('waits for all epic workers before fallback and emits final replacement sections', async () => {
    const base = provider(outline(3), tasks);
    const events: PlanStreamEvent[] = [];
    const llm: LlmProvider = {
      name: 'gemini',
      generateStructured: async (req) => {
        if (req.task === 'plan.tasks') {
          const epic = (req.input as { epic: { key: string } }).epic.key;
          if (epic === 'E1') throw new Error('fail');
          await new Promise((r) => setTimeout(r, 5));
        }
        return base.generateStructured(req);
      },
    };
    const result = await generatePlanPipeline(pipelineInput(), llm, async (e) => {
      events.push(e);
    });
    expect(result.model).toBe('template');
    const fallback = events.findIndex((e) => e.type === 'stage' && e.message.includes('unavailable'));
    expect(
      events
        .slice(fallback)
        .filter((e) => e.type === 'epic_tasks')
        .every((e) => e.epicKey === 'E1' || e.epicKey.startsWith('E-delivery')),
    ).toBe(true);
  });
  it('repairs duplicate task keys once and preserves the original idea', async () => {
    const base = provider(outline(2), (key) => tasks(key).map((t) => ({ ...t, key: 'duplicate' })));
    let repairs = 0;
    const llm: LlmProvider = {
      name: 'gemini',
      generateStructured: async (req) => {
        if (req.task === 'plan.repair') {
          repairs++;
          return req.schema.parse({
            idea: { ...planDocument.idea, title: 'Unwanted replacement' },
            outline: outline(2),
            tasks: [...tasks('E1'), ...tasks('E2')],
          });
        }
        return base.generateStructured(req);
      },
    };
    const result = await generatePlanPipeline(pipelineInput(), llm, async () => {});
    expect(repairs).toBe(1);
    expect(result.payload.idea).toEqual(planDocument.idea);
    expect(result.feasibility.issues.some((i) => i.message.includes('Duplicate task'))).toBe(false);
  });
  it('persists automatic cuts and exposes mandatory over-capacity rather than claiming feasibility', async () => {
    const input = pipelineInput();
    input.validation.totalEffectiveHours = 10;
    const result = await generatePlanPipeline(
      input,
      provider(outline(1), (key) => [
        ...tasks(key),
        { ...tasks(key)[0]!, key: 'optional', priority: 'could', estimateHours: 6 },
      ]),
      vi.fn(),
    );
    expect(result.feasibility.cutTaskKeys).toContain('optional');
    expect(result.payload.tasks.some((t) => t.key === 'optional')).toBe(false);
    input.validation.totalEffectiveHours = 0;
    const overloaded = await generatePlanPipeline(input, provider(outline(1), tasks), vi.fn());
    expect(overloaded.feasibility.ok).toBe(false);
  });
});
