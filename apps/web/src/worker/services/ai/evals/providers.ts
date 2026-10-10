/**
 * Offline providers for planning evals. They never touch the network.
 * - `scriptedPlanner`: a deterministic stand-in for a well-behaved model that drafts an outline and
 *   per-epic tasks from the idea in the request, so the LLM path (injection, cut line) is exercised.
 * - `unavailable`: always fails, forcing the pipeline's template fallback.
 * - `faultyPlanner`: drafts a cycle and an unknown skill, a negative control for the scorer.
 */
import { PlanOutline, TaskDrafts, type IdeaCandidate, type TaskDraft } from '@hakit/contracts';
import type { ZodType } from 'zod';
import type { LlmProvider, StructuredRequest } from '../types';

interface PlanInput {
  idea: IdeaCandidate;
  context: { constraints: { challenges: Array<{ key: string; title: string }> } };
  epic?: { key: string };
}

function outlineFor({ idea, context }: PlanInput): PlanOutline {
  return {
    summary: idea.pitch,
    scope: { must: idea.coreFeatures, should: ['Polish'], could: [], outOfScope: [] },
    architecture: {
      components: idea.stack.map((s) => ({
        name: s.component,
        responsibility: `Serve ${idea.title}`,
        tech: s.tech,
        skillSlugs: s.skillSlugs,
      })),
      dataFlow: ['User -> app -> API'],
    },
    milestones: [
      { key: 'M1', title: 'MVP', targetHour: 20 },
      { key: 'M2', title: 'Demo ready', targetHour: 30 },
    ],
    epics: [
      ...idea.stack.map((s, i) => ({
        key: `E${i + 1}`,
        title: s.component,
        milestoneKey: 'M1',
        scopeTier: 'must' as const,
        challengeKeys: [] as string[],
      })),
      ...context.constraints.challenges.map((c, i) => ({
        key: `C${i + 1}`,
        title: c.title,
        milestoneKey: 'M1',
        scopeTier: 'must' as const,
        challengeKeys: [c.key],
      })),
    ],
    risks: idea.risks,
  };
}

function tasksFor(input: PlanInput, faulty: boolean): TaskDraft[] {
  const { idea, epic } = input;
  const key = epic!.key;
  const stack = key.startsWith('E') ? idea.stack[Number(key.slice(1)) - 1] : idea.stack.at(-1);
  const skills = (stack?.skillSlugs ?? []).map((slug) => ({ slug, level: 2, weight: 1 }));
  const build: TaskDraft = {
    key: `${key}-T1`,
    epicKey: key,
    title: `Build ${stack?.component ?? key}`,
    description: `Implement ${stack?.tech ?? 'the integration'} for ${idea.title}`,
    acceptanceCriteria: ['Works end to end in the demo'],
    estimateHours: 3,
    requiredSkills: faulty ? [...skills, { slug: 'not-a-real-skill', level: 2, weight: 1 }] : skills,
    dependsOn: faulty ? [`${key}-T2`] : [],
    priority: 'must',
  };
  const polish: TaskDraft = {
    ...build,
    key: `${key}-T2`,
    title: `Polish ${stack?.component ?? key}`,
    estimateHours: 1.5,
    dependsOn: [build.key],
    priority: 'should',
    requiredSkills: skills,
  };
  return [build, polish];
}

function planner(name: 'gemini' | 'template', faulty: boolean): LlmProvider {
  return {
    name,
    async generateStructured<T extends ZodType>(req: StructuredRequest<T>) {
      const input = req.input as PlanInput;
      if (req.task === 'plan.outline') return req.schema.parse(PlanOutline.parse(outlineFor(input)));
      if (req.task === 'plan.tasks')
        return req.schema.parse(TaskDrafts.parse({ tasks: tasksFor(input, faulty) }));
      throw new Error(`scripted planner does not implement ${req.task}`);
    },
  };
}

export const scriptedPlanner = planner('gemini', false);
export const faultyPlanner = planner('gemini', true);
export const unavailable: LlmProvider = {
  name: 'gemini',
  generateStructured: async () => {
    throw new Error('provider unavailable (offline eval)');
  },
};
