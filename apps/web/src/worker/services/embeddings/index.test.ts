import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../env';
import { getServices } from '../index';
import { embeddingService, QWEN_MODEL } from './index';
const vector = () => Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));
const env = () =>
  ({
    HAKIT_MOCKS: '0',
    EMBED_MODEL: QWEN_MODEL,
    EMBED_DIM: '1024',
    HF_TOKEN: 'hf_private',
  }) as unknown as Env;
const cache = () => ({ get: vi.fn(async () => []), put: vi.fn(async () => {}) });
const ok = () =>
  vi.fn().mockResolvedValue(Response.json({ model: QWEN_MODEL, data: [{ index: 0, embedding: vector() }] }));
afterEach(() => vi.unstubAllGlobals());
describe('embedding service integration', () => {
  it('does not break unrelated services when embedding bindings are missing', async () => {
    const services = getServices({ HAKIT_MOCKS: '0' } as Env);
    expect(services.github).toBeDefined();
    await expect(services.embeddings.embed(['a'], 'query')).rejects.toMatchObject({ code: 'configuration' });
  });
  it('wires real embeddings and keeps mocks credential-free', async () => {
    const e = env();
    const mocks = getServices({ ...e, HAKIT_MOCKS: '1' });
    expect(mocks.embeddings.name).toBe('template');
    expect((await mocks.embeddings.embed(['a'], 'query'))[0]).toHaveLength(1024);
    expect(getServices(e).embeddings.model).toBe(QWEN_MODEL);
  });
  it('embeds through Hugging Face', async () => {
    const fetch = ok();
    vi.stubGlobal('fetch', fetch);
    const service = embeddingService(env(), cache());
    expect((await service.embed(['a'], 'document'))[0]).toHaveLength(1024);
    expect(service.name).toBe('hf');
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('reports unavailable when HF fails, and keeps breaker state across service calls', async () => {
    const e = env();
    const fetch = vi.fn().mockResolvedValue(new Response('down', { status: 503 }));
    vi.stubGlobal('fetch', fetch);
    for (let i = 0; i < 4; i++)
      await expect(embeddingService(e, cache()).embed(['a'], 'query')).rejects.toMatchObject({
        code: 'unavailable',
      });
    // Three failures open the breaker; the fourth call does not reach the network.
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('is a configuration error without an HF token (callers fall back to keyword matching)', async () => {
    const e = env();
    delete e.HF_TOKEN;
    const fetch = ok();
    vi.stubGlobal('fetch', fetch);
    await expect(embeddingService(e, cache()).embed(['a'], 'query')).rejects.toMatchObject({
      code: 'configuration',
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('refuses an incompatible configured dimension', async () => {
    const e = env();
    e.EMBED_DIM = '384';
    await expect(embeddingService(e, cache()).embed(['a'], 'query')).rejects.toMatchObject({
      code: 'configuration',
    });
  });
});
