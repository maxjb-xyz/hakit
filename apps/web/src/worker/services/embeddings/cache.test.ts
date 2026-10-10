import { describe, expect, it, vi } from 'vitest';
import { cachedEmbeddings, embeddingHash, type CachedVector, type EmbeddingCache } from './cache';
import { QWEN_MODEL } from './providers';
const vector = (): number[] => Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));
function setup() {
  const rows = new Map<string, CachedVector>();
  const cache: EmbeddingCache = {
    get: vi.fn(async (_model: string, hashes: string[]) =>
      hashes.flatMap((hash) => (rows.has(hash) ? [rows.get(hash)!] : [])),
    ),
    put: vi.fn(async (_model: string, incoming: CachedVector[]) => {
      incoming.forEach((row) => rows.set(row.hash, row));
    }),
  };
  const embed = vi.fn(async (texts: string[]) => texts.map(() => vector()));
  const provider = { name: 'hf' as const, model: QWEN_MODEL, dim: 1024, embed };
  return { cache, rows, embed, service: cachedEmbeddings(provider, cache) };
}
describe('embedding content cache', () => {
  it('hashes model, dimension, kind, and instruction consistently without exposing text', async () => {
    const hash = await embeddingHash(QWEN_MODEL, 1024, 'private text', 'query');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(await embeddingHash(QWEN_MODEL, 1024, 'private text', 'query')).toBe(hash);
    expect(await embeddingHash(QWEN_MODEL, 1024, 'private text', 'document')).not.toBe(hash);
    expect(await embeddingHash('other', 1024, 'private text', 'query')).not.toBe(hash);
    expect(await embeddingHash(QWEN_MODEL, 384, 'private text', 'query')).not.toBe(hash);
  });
  it('embeds each distinct text once and preserves duplicates and input order', async () => {
    const s = setup();
    const result = await s.service.embed(['a', 'b', 'a'], 'query');
    expect(s.embed).toHaveBeenCalledWith(['a', 'b'], 'query');
    expect(result).toHaveLength(3);
    result[0]![0] = 99;
    expect(result[2]![0]).toBe(1);
    const next = await s.service.embed(['b', 'a'], 'query');
    expect(s.embed).toHaveBeenCalledTimes(1);
    expect(next[1]![0]).toBe(1);
  });
  it('only requests cache misses in mixed batches', async () => {
    const s = setup();
    await s.service.embed(['a'], 'document');
    await s.service.embed(['a', 'b'], 'document');
    expect(s.embed.mock.calls[1]![0]).toEqual(['b']);
  });
  it('does not reuse a document vector for a query', async () => {
    const s = setup();
    await s.service.embed(['a'], 'document');
    await s.service.embed(['a'], 'query');
    expect(s.embed).toHaveBeenCalledTimes(2);
  });
  it('recomputes corrupt cache rows', async () => {
    const s = setup();
    const hash = await embeddingHash(QWEN_MODEL, 1024, 'a', 'query');
    s.rows.set(hash, { hash, embedding: [1, 2] });
    expect((await s.service.embed(['a'], 'query'))[0]).toHaveLength(1024);
    expect(s.embed).toHaveBeenCalledTimes(1);
  });
  it('still works when cache reads and writes fail', async () => {
    const s = setup();
    vi.mocked(s.cache.get).mockRejectedValue(new Error('DB down'));
    vi.mocked(s.cache.put).mockRejectedValue(new Error('DB down'));
    expect((await s.service.embed(['a'], 'query'))[0]).toHaveLength(1024);
  });
  it('shares simultaneous identical requests', async () => {
    const s = setup();
    let resolve!: (vectors: number[][]) => void;
    s.embed.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const a = s.service.embed(['a'], 'query');
    const b = s.service.embed(['a'], 'query');
    await vi.waitFor(() => expect(s.embed).toHaveBeenCalledTimes(1));
    resolve([vector()]);
    expect(await a).toEqual(await b);
  });
  it('retries after an in-flight provider failure and never caches invalid vectors', async () => {
    const s = setup();
    s.embed.mockRejectedValueOnce(new Error('Provider down'));
    await expect(s.service.embed(['a'], 'query')).rejects.toThrow();
    await s.service.embed(['a'], 'query');
    expect(s.embed).toHaveBeenCalledTimes(2);
    const other = setup();
    other.embed.mockResolvedValue([[1, 2]]);
    await expect(other.service.embed(['a'], 'query')).rejects.toMatchObject({ code: 'invalid_output' });
    expect(other.cache.put).not.toHaveBeenCalled();
  });
  it('does no work for empty input and rejects invalid text before cache calls', async () => {
    const s = setup();
    expect(await s.service.embed([], 'query')).toEqual([]);
    await expect(s.service.embed([' '], 'query')).rejects.toThrow();
    expect(s.cache.get).not.toHaveBeenCalled();
  });
});
