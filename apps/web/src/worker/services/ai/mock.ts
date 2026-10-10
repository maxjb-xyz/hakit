import type { z } from 'zod';
import { IdeaCandidates, PlanOutline, TaskDrafts } from '@hakit/contracts';
import { planDocument } from '@hakit/contracts/fixtures';
import type { EmbeddingProvider, LlmProvider, StructuredRequest } from './types';

/** Deterministic fixture-backed LLM for mock mode and tests. Add cases as tasks need them. */
export const mockLlm: LlmProvider = {
  name: 'template',
  async generateStructured<T extends z.ZodType>(req: StructuredRequest<T>): Promise<z.output<T>> {
    const byTask: Partial<Record<StructuredRequest<T>['task'], unknown>> = {
      'ideas.generate': IdeaCandidates.parse({ ideas: [planDocument.idea] }),
      'plan.outline': PlanOutline.parse(planDocument.outline),
      'plan.tasks': TaskDrafts.parse({ tasks: planDocument.tasks }),
    };
    const out = byTask[req.task];
    if (out === undefined) throw new Error(`mockLlm has no fixture for ${req.task}`);
    return req.schema.parse(out);
  },
};

/** Hash-seeded unit vectors: identical text → identical vector; good enough for wiring tests. */
export function mockEmbeddings(dim: number): EmbeddingProvider {
  return {
    name: 'template',
    model: 'mock-hash',
    dim,
    async embed(texts) {
      return texts.map((t) => {
        let seed = 2166136261;
        for (let i = 0; i < t.length; i++) seed = Math.imul(seed ^ t.charCodeAt(i), 16777619);
        const v = Array.from({ length: dim }, (_, i) => (Math.sin(seed + i * 12.9898) * 43758.5453) % 1);
        const n = Math.hypot(...v) || 1;
        return v.map((x) => x / n);
      });
    },
  };
}
