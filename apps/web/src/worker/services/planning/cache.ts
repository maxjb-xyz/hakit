/** Project-scoped durable cache backed by the existing plans.prompt_hash column. */
import { Feasibility, PlanDocument, type PlanStreamEvent } from '@hakit/contracts';
import { DEFAULT_CONFIG } from '@hakit/engine';
import { sha256Hex } from '../../lib/crypto';
import type { LlmProvider } from '../ai/types';
import { generatePlanPipeline, PLANNING_SYSTEM, type PipelineInput } from './pipeline';

type Stored = { payload: unknown; feasibility: unknown; model: string };
const canonical = (v: unknown): unknown => {
  if (v instanceof Map)
    return [...v].sort(([a], [b]) => String(a).localeCompare(String(b))).map(([k, x]) => [k, canonical(x)]);
  if (v instanceof Set) return [...v].sort();
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.entries(v)
        .filter(([, x]) => x !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, x]) => [k, canonical(x)]),
    );
  return v;
};

/** Five-minute conservative clock buckets make repeat requests useful without adding time/capacity. */
export function cachedPlanningInput(input: PipelineInput): PipelineInput {
  const down = (n: number) => Math.floor(n * 12 + 1e-9) / 12;
  const members = input.context.team.members.map((m) => ({ ...m, availableHours: down(m.availableHours) }));
  return {
    ...input,
    eventElapsedHours: down(input.eventElapsedHours ?? 0),
    context: {
      ...input.context,
      team: {
        ...input.context.team,
        members,
        totalEffectiveHours: Math.min(
          input.context.team.totalEffectiveHours,
          members.reduce((sum, m) => sum + m.availableHours * DEFAULT_CONFIG.focusFactor, 0),
        ),
      },
      hackathon: { ...input.context.hackathon, hoursRemaining: down(input.context.hackathon.hoursRemaining) },
    },
  };
}

export async function planPromptHash(input: PipelineInput, projectId: string, model: string) {
  const normalized = cachedPlanningInput(input);
  return sha256Hex(
    JSON.stringify(
      canonical({
        version: 'planning-cache-v1',
        system: PLANNING_SYSTEM,
        model,
        projectId,
        idea: normalized.idea,
        context: normalized.context,
        guidance: normalized.guidance,
        eventElapsedHours: normalized.eventElapsedHours,
        config: DEFAULT_CONFIG,
        validation: {
          ...input.validation,
          totalEffectiveHours: normalized.context.team.totalEffectiveHours,
          hoursUntilDeadline: normalized.context.hackathon.hoursRemaining,
        },
      }),
    ),
  );
}

export async function generateCachedPlan(
  input: PipelineInput,
  llm: LlmProvider,
  send: (event: PlanStreamEvent) => Promise<void>,
  options: { projectId: string; model: string; find: (hash: string) => Promise<Stored | undefined> },
) {
  const normalized = cachedPlanningInput(input);
  const hash = await planPromptHash(input, options.projectId, options.model);
  const stored = await options.find(hash);
  const payload = PlanDocument.safeParse(stored?.payload);
  const feasibility = Feasibility.safeParse(stored?.feasibility);
  // Templates, edited/invalid results and cut drafts must not mask recovery or lose cut-line history.
  const cached =
    stored?.model === 'gemini' &&
    payload.success &&
    feasibility.success &&
    feasibility.data.ok &&
    JSON.stringify(canonical(payload.data.idea)) === JSON.stringify(canonical(input.idea)) &&
    !feasibility.data.cutTaskKeys.length
      ? { payload: payload.data, model: stored.model }
      : undefined;
  const result = await generatePlanPipeline(normalized, llm, send, cached);
  return {
    ...result,
    promptHash:
      result.model === 'gemini' && result.feasibility.ok && !result.feasibility.cutTaskKeys.length
        ? hash
        : null,
  };
}
