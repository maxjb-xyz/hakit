import { and, eq, inArray, sql } from 'drizzle-orm';
import { chunkIds, chunkRows, columnCount, commit, createDb, schema, type Db } from '@hakit/db';
import type { EmbeddingProvider } from '../ai/types';
import { prepareTexts, validateTexts, validateVectors } from './providers';

export interface CachedVector {
  hash: string;
  embedding: number[];
}
export interface EmbeddingCache {
  get(model: string, hashes: string[]): Promise<CachedVector[]>;
  put(model: string, rows: CachedVector[]): Promise<void>;
}
export function databaseEmbeddingCache(db: Db): EmbeddingCache {
  return {
    // Chunked: D1 caps bound parameters per statement.
    get: async (model, hashes) =>
      (
        await Promise.all(
          chunkIds(hashes).map((chunk) =>
            db
              .select({ hash: schema.embeddingCache.hash, embedding: schema.embeddingCache.embedding })
              .from(schema.embeddingCache)
              .where(and(eq(schema.embeddingCache.model, model), inArray(schema.embeddingCache.hash, chunk))),
          ),
        )
      ).flat(),
    async put(model, rows) {
      await commit(
        db,
        chunkRows(
          rows.map((row) => ({ ...row, model })),
          columnCount(schema.embeddingCache),
        ).map((chunk) =>
          db
            .insert(schema.embeddingCache)
            .values(chunk)
            .onConflictDoUpdate({
              target: [schema.embeddingCache.hash, schema.embeddingCache.model],
              set: { embedding: sql`excluded.embedding` },
            }),
        ),
      );
    },
  };
}
/** Cache on the D1 binding, opened per call. Provider calls happen outside any DB write. */
export function d1EmbeddingCache(d1: D1Database): EmbeddingCache {
  const run = async <T>(operation: (cache: EmbeddingCache) => Promise<T>): Promise<T> => {
    const handle = createDb(d1);
    try {
      await handle.ready;
      return await operation(databaseEmbeddingCache(handle.db));
    } finally {
      await handle.close();
    }
  };
  return {
    get: (model, hashes) => run((cache) => cache.get(model, hashes)),
    put: (model, rows) => run((cache) => cache.put(model, rows)),
  };
}
export async function embeddingHash(
  model: string,
  dim: number,
  text: string,
  kind: 'query' | 'document',
): Promise<string> {
  const prepared = prepareTexts([text], kind)[0];
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(['hakit-embedding-v1', model, dim, kind, prepared])),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
export function cachedEmbeddings(provider: EmbeddingProvider, cache: EmbeddingCache): EmbeddingProvider {
  const inFlight = new Map<string, Promise<CachedVector[]>>();
  return {
    get name() {
      return provider.name;
    },
    model: provider.model,
    dim: provider.dim,
    async embed(texts, kind) {
      validateTexts(texts, kind);
      if (!texts.length) return [];
      const hashes = await Promise.all(
        texts.map((text) => embeddingHash(provider.model, provider.dim, text, kind)),
      );
      const unique = new Map(hashes.map((hash, i) => [hash, texts[i]!]));
      const found = new Map<string, number[]>();
      try {
        for (const row of await cache.get(provider.model, [...unique.keys()])) {
          if (!unique.has(row.hash)) continue;
          try {
            found.set(row.hash, validateVectors([row.embedding], 1, provider.dim)[0]!);
          } catch {
            /* Recompute corrupt/incompatible rows. */
          }
        }
      } catch {
        /* The cache is an optimization; outages must not block provider fallback. */
      }
      const missing = [...unique.keys()].filter((hash) => !found.has(hash));
      if (missing.length) {
        const key = JSON.stringify([kind, missing]);
        let pending = inFlight.get(key);
        if (!pending) {
          pending = (async () => {
            const vectors = validateVectors(
              await provider.embed(
                missing.map((hash) => unique.get(hash)!),
                kind,
              ),
              missing.length,
              provider.dim,
            );
            const rows = missing.map((hash, i) => ({ hash, embedding: vectors[i]! }));
            try {
              await cache.put(provider.model, rows);
            } catch {
              /* Return useful vectors even if cache persistence fails. */
            }
            return rows;
          })();
          inFlight.set(key, pending);
        }
        try {
          for (const row of await pending) found.set(row.hash, row.embedding);
        } finally {
          if (inFlight.get(key) === pending) inFlight.delete(key);
        }
      }
      // Return independent arrays so consumer edits cannot poison duplicates or cache.
      return hashes.map((hash) => [...found.get(hash)!]);
    },
  };
}
