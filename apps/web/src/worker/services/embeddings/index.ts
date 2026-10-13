import { EMBED_DIM } from '@hakit/db';
import type { Env } from '../../env';
import type { EmbeddingProvider } from '../ai/types';
import { bindingRun } from '../ai';
import { EmbeddingError, hfEmbeddings, QWEN_MODEL, workersAiEmbeddings } from './providers';
import { cachedEmbeddings, d1EmbeddingCache, type EmbeddingCache } from './cache';
import { embeddingRouter } from './router';
import { meteredEmbeddings, type AiMeter } from '../ai/usage';
export * from './providers';
export * from './cache';
export * from './router';

const routers = new WeakMap<Env, EmbeddingProvider>();
/**
 * Initialize lazily: unavailable AI configuration must not break unrelated API routes.
 * `meter` (services/ai/usage.ts) charges a workspace for each request that misses the cache. Callers that
 * embed on behalf of no workspace (taxonomy, skill search, health checks) pass none and are exempt.
 */
export function embeddingService(env: Env, cache?: EmbeddingCache, meter?: AiMeter): EmbeddingProvider {
  let cached: EmbeddingProvider | undefined;
  return {
    get name() {
      return cached?.name ?? (env.AI ? 'workers_ai' : 'hf');
    },
    model: env.EMBED_MODEL,
    dim: Number(env.EMBED_DIM),
    // The router exists only after the first embed in this isolate; before that nothing has failed.
    health: () => routers.get(env)?.health?.() ?? [],
    async embed(texts, kind) {
      if (env.EMBED_MODEL !== QWEN_MODEL || Number(env.EMBED_DIM) !== EMBED_DIM)
        throw new EmbeddingError(
          'configuration',
          'Embedding model/dimension must match the Qwen3 1024-dimensional database',
        );
      if (!cached) {
        let router = routers.get(env);
        if (!router) {
          const dim = Number(env.EMBED_DIM);
          // Workers AI first, Hugging Face as an optional fallback (same model, same vector space).
          // With neither, callers fall back to keyword matching.
          const providers: EmbeddingProvider[] = [];
          if (env.AI)
            providers.push(workersAiEmbeddings({ run: bindingRun(env.AI), model: env.EMBED_MODEL, dim }));
          if (env.HF_TOKEN)
            providers.push(hfEmbeddings({ token: env.HF_TOKEN, model: env.EMBED_MODEL, dim }));
          if (!providers.length)
            throw new EmbeddingError(
              'configuration',
              'No embedding provider: bind Workers AI (AI) or set HF_TOKEN; embeddings are unavailable',
            );
          router = embeddingRouter(providers);
          routers.set(env, router);
        }
        cached = cachedEmbeddings(
          meter ? meteredEmbeddings(router, meter) : router,
          cache ?? d1EmbeddingCache(env.DB),
        );
      }
      return cached.embed(texts, kind);
    },
  };
}
