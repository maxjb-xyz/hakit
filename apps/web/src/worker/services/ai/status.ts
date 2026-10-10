/**
 * GET /ai/status (T-301): configured providers plus circuit-breaker health in this isolate.
 * Without a key the deterministic fallback (templates / keyword matching) is what serves the role.
 * No network call: a status read must never spend quota or leak credentials.
 */
import type { AiProviderStatus } from '@hakit/contracts';
import { EMBED_DIM } from '@hakit/db';
import type { Env } from '../../env';
import type { Services } from '..';
import { QWEN_MODEL } from '../embeddings';

export function aiProviderStatus(
  env: Env,
  services: Pick<Services, 'llm' | 'embeddings'>,
): AiProviderStatus[] {
  const gemini = services.llm.health?.().find((h) => h.name === 'gemini');
  const llm: AiProviderStatus[] = env.GEMINI_API_KEY
    ? (
        [
          ['plan', env.GEMINI_MODEL_PLAN],
          ['fast', env.GEMINI_MODEL_FAST],
        ] as const
      ).map(([role, model]) => ({
        provider: 'gemini',
        role,
        model,
        healthy: gemini?.healthy ?? true,
        lastErrorAt: gemini?.lastErrorAt ?? null,
      }))
    : (['plan', 'fast'] as const).map((role) => ({
        provider: 'template',
        role,
        model: 'template',
        healthy: true,
        lastErrorAt: null,
      }));
  const configured = !!env.HF_TOKEN && env.EMBED_MODEL === QWEN_MODEL && Number(env.EMBED_DIM) === EMBED_DIM;
  const hf = services.embeddings.health?.().find((h) => h.name === 'hf');
  const embeddings: AiProviderStatus = configured
    ? {
        provider: 'hf',
        role: 'embeddings',
        model: env.EMBED_MODEL,
        healthy: hf?.healthy ?? true,
        lastErrorAt: hf?.lastErrorAt ?? null,
      }
    : { provider: 'keyword', role: 'embeddings', model: 'keyword', healthy: true, lastErrorAt: null };
  return [...llm, embeddings];
}
