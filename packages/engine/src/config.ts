import type { EngineConfig } from './types';

/** Defaults from docs/AI.md. Change here, not inline. */
export const DEFAULT_CONFIG: EngineConfig = {
  focusFactor: 0.7,
  capacityHeadroom: 0.85,
  integrationBuffer: 1.3,
  weights: { relevance: 0.5, workload: 0.2, preference: 0.1, continuity: 0.1, availability: 0.1 },
  relevanceWeights: { skill: 0.65, semantic: 0.25, interest: 0.1 },
  criticalPathMinRelevance: 0.6,
  criticalPathPenalty: 0.3,
  stallMinutes: 90,
};
