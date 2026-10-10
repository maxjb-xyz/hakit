import { EMBED_DIM } from '@hakit/db';
import type { Env } from '../../env';
import type { EmbeddingProvider } from '../ai/types';
import { amdEmbeddings, EmbeddingError, hfEmbeddings, QWEN_MODEL, workersAiEmbeddings } from './providers';
import { cachedEmbeddings, hyperdriveEmbeddingCache, type EmbeddingCache } from './cache';
import { embeddingRouter } from './router';
export * from './providers';
export * from './cache';
export * from './router';

const routers = new WeakMap<Env, EmbeddingProvider>();
/** Initialize lazily: unavailable AI configuration must not break unrelated API routes. */
export function embeddingService(env: Env, cache?: EmbeddingCache): EmbeddingProvider {
  let cached: EmbeddingProvider | undefined;
  return {
    get name() {
      return (
        cached?.name ??
        (env.HF_TOKEN ? 'hf' : env.AMD_EMBED_BASE_URL && env.AMD_LLM_KEY ? 'amd' : 'workers_ai')
      );
    },
    model: env.EMBED_MODEL,
    dim: Number(env.EMBED_DIM),
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
          const providers: EmbeddingProvider[] = [];
          if (env.HF_TOKEN)
            providers.push(hfEmbeddings({ token: env.HF_TOKEN, model: env.EMBED_MODEL, dim }));
          if (env.AMD_EMBED_BASE_URL && env.AMD_LLM_KEY)
            providers.push(
              amdEmbeddings({
                baseUrl: env.AMD_EMBED_BASE_URL,
                token: env.AMD_LLM_KEY,
                model: env.EMBED_MODEL,
                dim,
              }),
            );
          providers.push(workersAiEmbeddings(env.AI, env.WORKERS_AI_EMBED_MODEL, dim, env.EMBED_MODEL));
          router = embeddingRouter(providers);
          routers.set(env, router);
        }
        cached = cachedEmbeddings(
          router,
          cache ?? hyperdriveEmbeddingCache(() => env.HYPERDRIVE.connectionString),
        );
      }
      return cached.embed(texts, kind);
    },
  };
}
