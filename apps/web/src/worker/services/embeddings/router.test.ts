import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EmbeddingProvider } from '../ai/types';
import { embeddingRouter } from './router';
import { QWEN_MODEL } from './providers';
const vectors = () => [Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0))];
const provider = (name: EmbeddingProvider['name']) => ({
  name,
  model: QWEN_MODEL,
  dim: 1024,
  embed: vi.fn().mockResolvedValue(vectors()),
});
afterEach(() => vi.useRealTimers());
describe('embedding fallback and breakers', () => {
  it('uses HF primary without contacting fallbacks', async () => {
    const hf = provider('hf');
    const amd = provider('amd');
    const router = embeddingRouter([hf, amd]);
    expect(await router.embed(['a'], 'query')).toEqual(vectors());
    expect(amd.embed).not.toHaveBeenCalled();
    expect(router.name).toBe('hf');
  });
  it('falls through HF and AMD failures to real-shaped Workers AI vectors', async () => {
    const hf = provider('hf');
    const amd = provider('amd');
    const workers = provider('workers_ai');
    hf.embed.mockRejectedValue(new Error('HF failure'));
    amd.embed.mockRejectedValue(new Error('AMD failure'));
    const router = embeddingRouter([hf, amd, workers]);
    expect((await router.embed(['a'], 'query'))[0]).toHaveLength(1024);
    expect(router.name).toBe('workers_ai');
  });
  it('treats malformed provider vectors as failures', async () => {
    const hf = provider('hf');
    hf.embed.mockResolvedValue([[1, 2]]);
    expect((await embeddingRouter([hf, provider('workers_ai')]).embed(['a'], 'query'))[0]).toHaveLength(1024);
  });
  it('opens after three failures in 60s and recovers after two minutes', async () => {
    let now = 0;
    const hf = provider('hf');
    const workers = provider('workers_ai');
    hf.embed.mockRejectedValue(new Error());
    const router = embeddingRouter([hf, workers], () => now);
    for (let i = 0; i < 4; i++) await router.embed(['a'], 'query');
    expect(hf.embed).toHaveBeenCalledTimes(3);
    now = 120_001;
    hf.embed.mockResolvedValue(vectors());
    await router.embed(['a'], 'query');
    expect(router.name).toBe('hf');
    await router.embed(['a'], 'query');
    expect(hf.embed).toHaveBeenCalledTimes(5);
  });
  it('expires failures outside the rolling window and resets on success', async () => {
    let now = 0;
    const hf = provider('hf');
    hf.embed.mockRejectedValue(new Error());
    const router = embeddingRouter([hf, provider('workers_ai')], () => now);
    for (let i = 0; i < 4; i++) {
      await router.embed(['a'], 'query');
      now += 61_000;
    }
    expect(hf.embed).toHaveBeenCalledTimes(4);
    hf.embed.mockResolvedValue(vectors());
    await router.embed(['a'], 'query');
    hf.embed.mockRejectedValue(new Error());
    for (let i = 0; i < 3; i++) await router.embed(['a'], 'query');
    expect(hf.embed).toHaveBeenCalledTimes(8);
  });
  it('reopens immediately after a failed half-open probe', async () => {
    let now = 0;
    const hf = provider('hf');
    hf.embed.mockRejectedValue(new Error());
    const router = embeddingRouter([hf, provider('workers_ai')], () => now);
    for (let i = 0; i < 3; i++) await router.embed(['a'], 'query');
    now = 120_001;
    await router.embed(['a'], 'query');
    await router.embed(['a'], 'query');
    expect(hf.embed).toHaveBeenCalledTimes(4);
  });
  it('allows only one half-open probe while concurrent calls use fallback', async () => {
    let now = 0;
    let resolve!: (value: number[][]) => void;
    const hf = provider('hf');
    hf.embed.mockRejectedValue(new Error());
    const router = embeddingRouter([hf, provider('workers_ai')], () => now);
    for (let i = 0; i < 3; i++) await router.embed(['a'], 'query');
    now = 120_001;
    hf.embed.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const first = router.embed(['a'], 'query');
    await router.embed(['a'], 'query');
    expect(hf.embed).toHaveBeenCalledTimes(4);
    resolve(vectors());
    await first;
  });
  it('returns a safe unavailable error when every provider fails', async () => {
    const hf = provider('hf');
    hf.embed.mockRejectedValue(new Error('secret'));
    await expect(embeddingRouter([hf]).embed(['private'], 'query')).rejects.toMatchObject({
      code: 'unavailable',
      message: expect.not.stringContaining('secret'),
    });
  });
  it('does not accept mixed models/dimensions or invalid text', async () => {
    expect(() => embeddingRouter([])).toThrow();
    expect(() => embeddingRouter([provider('hf'), { ...provider('amd'), model: 'other' }])).toThrow();
    expect(() => embeddingRouter([provider('hf'), { ...provider('amd'), dim: 384 }])).toThrow();
    const hf = provider('hf');
    await expect(embeddingRouter([hf]).embed([''], 'query')).rejects.toMatchObject({ code: 'invalid_input' });
    expect(hf.embed).not.toHaveBeenCalled();
    expect(await embeddingRouter([hf]).embed([], 'query')).toEqual([]);
  });
});
