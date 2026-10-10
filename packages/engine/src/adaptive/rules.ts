/** Adaptive execution rules (docs/AI.md §C.6). Owner: IN. Tasks: T-504 (v1), T-507 (v2). */
import type { RecommendationDraft } from '@hakit/contracts';
import type { EngineConfig, ProjectState } from '../types';
import type { ScheduleResult } from '../schedule/cpm';
import { NotImplementedError } from '../errors';

export type Rule = (
  state: ProjectState,
  schedule: ScheduleResult,
  config: EngineConfig,
) => RecommendationDraft[];

export const stalledTask: Rule = () => {
  throw new NotImplementedError('T-504', 'stalledTask rule');
};
export const workloadImbalance: Rule = () => {
  throw new NotImplementedError('T-504', 'workloadImbalance rule');
};
export const criticalPathSlip: Rule = () => {
  throw new NotImplementedError('T-504', 'criticalPathSlip rule');
};

export const RULES_V1: Rule[] = [stalledTask, workloadImbalance, criticalPathSlip];

/** Runs all rules; dedupes by dedupeKey (first wins). */
export function evaluateRules(
  state: ProjectState,
  schedule: ScheduleResult,
  config: EngineConfig,
  rules: Rule[] = RULES_V1,
): RecommendationDraft[] {
  const seen = new Set<string>();
  const out: RecommendationDraft[] = [];
  for (const rule of rules) {
    for (const draft of rule(state, schedule, config)) {
      if (seen.has(draft.dedupeKey)) continue;
      seen.add(draft.dedupeKey);
      out.push(draft);
    }
  }
  return out;
}
