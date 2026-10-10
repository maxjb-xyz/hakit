import { EMBED_DIM } from '@hakit/db';
import type { Env } from '../../env';
import type { EmbeddingProvider } from '../ai/types';
import { EmbeddingError, hfEmbeddings, QWEN_MODEL } from './providers';
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
      return cached?.name ?? 'hf';
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
          // Hugging Face is the only embedding API; without it callers fall back to keyword matching.
          if (!env.HF_TOKEN)
            throw new EmbeddingError('configuration', 'HF_TOKEN is not set; embeddings are unavailable');
          const providers: EmbeddingProvider[] = [
            hfEmbeddings({ token: env.HF_TOKEN, model: env.EMBED_MODEL, dim }),
          ];
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
