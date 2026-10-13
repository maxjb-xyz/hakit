/**
 * GET /ai/status (T-301): configured providers plus circuit-breaker health in this isolate.
 * With no provider configured the deterministic fallback (templates / keyword matching) is what serves the role.
 * No network call: a status read must never spend quota or leak credentials.
 */
import type { AiProviderStatus } from '@hakit/contracts';
import { EMBED_DIM } from '@hakit/db';
import type { Env } from '../../env';
import type { Services } from '..';
import { QWEN_MODEL } from '../embeddings';
import { GEMINI_DEFAULT_FAST, GEMINI_DEFAULT_PLAN } from './index';

export function aiProviderStatus(
  env: Env,
  services: Pick<Services, 'llm' | 'embeddings'>,
): AiProviderStatus[] {
  const llmHealth = services.llm.health?.() ?? [];
  // The first configured provider serves the role; the router falls back down this list.
  const primary = env.AI
    ? ({ provider: 'workers_ai', plan: env.AI_MODEL_PLAN, fast: env.AI_MODEL_FAST } as const)
    : env.GEMINI_API_KEY
      ? ({
          provider: 'gemini',
          plan: env.GEMINI_MODEL_PLAN ?? GEMINI_DEFAULT_PLAN,
          fast: env.GEMINI_MODEL_FAST ?? GEMINI_DEFAULT_FAST,
        } as const)
      : undefined;
  const llm: AiProviderStatus[] = (['plan', 'fast'] as const).map((role) => {
    if (!primary) return { provider: 'template', role, model: 'template', healthy: true, lastErrorAt: null };
    const health = llmHealth.find((h) => h.name === primary.provider);
    return {
      provider: primary.provider,
      role,
      model: primary[role],
      healthy: health?.healthy ?? true,
      lastErrorAt: health?.lastErrorAt ?? null,
    };
  });
  const embedProvider = env.AI ? 'workers_ai' : env.HF_TOKEN ? 'hf' : undefined;
  const configured = !!embedProvider && env.EMBED_MODEL === QWEN_MODEL && Number(env.EMBED_DIM) === EMBED_DIM;
  const health = services.embeddings.health?.().find((h) => h.name === embedProvider);
  const embeddings: AiProviderStatus = configured
    ? {
        provider: embedProvider,
        role: 'embeddings',
        model: env.EMBED_MODEL,
        healthy: health?.healthy ?? true,
        lastErrorAt: health?.lastErrorAt ?? null,
      }
    : { provider: 'keyword', role: 'embeddings', model: 'keyword', healthy: true, lastErrorAt: null };
  return [...llm, embeddings];
}
