import type { EmbeddingProvider } from '../ai/types';
import { EmbeddingError, validateTexts, validateVectors, withTimeout } from './providers';

/** Breakers are local to this router/isolate; no credentials or text are logged. */
export function embeddingRouter(
  providers: EmbeddingProvider[],
  now: () => number = Date.now,
): EmbeddingProvider {
  if (
    !providers.length ||
    providers.some((provider) => provider.model !== providers[0]!.model || provider.dim !== providers[0]!.dim)
  ) {
    throw new EmbeddingError(
      'configuration',
      'Embedding fallback providers must use one model and dimension',
    );
  }
  const state = providers.map(() => ({ failures: [] as number[], openUntil: 0, probing: false }));
  let selected = providers[0]!.name;
  return {
    get name() {
      return selected;
    },
    model: providers[0]!.model,
    dim: providers[0]!.dim,
    async embed(texts, kind) {
      validateTexts(texts, kind);
      if (!texts.length) return [];
      for (const [i, provider] of providers.entries()) {
        const breaker = state[i]!;
        const time = now();
        if (breaker.openUntil > time || breaker.probing) continue;
        const probe = breaker.openUntil !== 0;
        if (probe) breaker.probing = true;
        try {
          const vectors = validateVectors(
            await withTimeout(() => provider.embed(texts, kind)),
            texts.length,
            provider.dim,
          );
          breaker.failures = [];
          breaker.openUntil = 0;
          selected = provider.name;
          return vectors;
        } catch {
          breaker.failures = breaker.failures.filter((failure) => now() - failure < 60_000);
          breaker.failures.push(now());
          if (probe || breaker.failures.length >= 3) breaker.openUntil = now() + 120_000;
        } finally {
          breaker.probing = false;
        }
      }
      throw new EmbeddingError(
        'unavailable',
        'All embedding providers are unavailable; use deterministic matching or retry later',
      );
    },
  };
}
