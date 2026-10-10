import { z } from 'zod';

/**
 * Convert a Zod schema to JSON Schema for Gemini `responseJsonSchema` (INTEGRATIONS §3).
 * Gemini rejects some keywords; strip them. Always re-validate the response with the Zod schema.
 */
export function toGeminiSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: 'draft-2020-12', unrepresentable: 'any' }) as Record<
    string,
    unknown
  >;
  return strip(json) as Record<string, unknown>;
}

const DROP_KEYS = new Set(['$schema', 'additionalProperties', '$id']);

function strip(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strip);
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (DROP_KEYS.has(k)) continue;
      out[k] = strip(v);
    }
    return out;
  }
  return node;
}

/** Names of every structured AI task; used for logging, prompt files, and the provider router. */
export const AiTaskName = z.enum([
  'ideas.generate',
  'ideas.refine',
  'plan.outline',
  'plan.tasks',
  'plan.repair',
  'assign.explain',
  'recs.phrase',
  'team.summary',
  'activity.summarize',
]);
export type AiTaskName = z.infer<typeof AiTaskName>;

export const AiProviderStatus = z.object({
  provider: z.enum(['gemini', 'hf', 'amd', 'workers_ai', 'template', 'keyword']),
  role: z.enum(['plan', 'fast', 'embeddings']),
  model: z.string(),
  healthy: z.boolean(),
  lastErrorAt: z.string().nullable(),
});
export type AiProviderStatus = z.infer<typeof AiProviderStatus>;
