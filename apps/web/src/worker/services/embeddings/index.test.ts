import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../env';
import { getServices } from '../index';
import { embeddingService, QWEN_MODEL, WORKERS_QWEN_MODEL } from './index';
const vector = () => Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));
const env = () =>
  ({
    HAKIT_MOCKS: '0',
    EMBED_MODEL: QWEN_MODEL,
    EMBED_DIM: '1024',
    WORKERS_AI_EMBED_MODEL: WORKERS_QWEN_MODEL,
    HF_TOKEN: 'hf_private',
    AI: { run: vi.fn().mockResolvedValue({ data: [vector()] }) },
  }) as unknown as Env;
const cache = () => ({ get: vi.fn(async () => []), put: vi.fn(async () => {}) });
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
  it('falls back from HF to Workers AI and retains breaker state across service calls', async () => {
    const e = env();
    const fetch = vi.fn().mockResolvedValue(new Response('down', { status: 503 }));
    vi.stubGlobal('fetch', fetch);
    for (let i = 0; i < 4; i++)
      expect((await embeddingService(e, cache()).embed(['a'], 'query'))[0]).toHaveLength(1024);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(e.AI.run).toHaveBeenCalledTimes(4);
  });
  it('uses Workers AI when HF is not configured', async () => {
    const e = env();
    delete e.HF_TOKEN;
    expect((await embeddingService(e, cache()).embed(['a'], 'query'))[0]).toHaveLength(1024);
  });
  it('refuses an incompatible configured dimension', async () => {
    const e = env();
    e.EMBED_DIM = '384';
    await expect(embeddingService(e, cache()).embed(['a'], 'query')).rejects.toMatchObject({
      code: 'configuration',
    });
  });
});

it('does not let an invalid optional AMD endpoint block healthy HF or Workers AI', async () => {
  const e = env();
  e.AMD_EMBED_BASE_URL = 'http://invalid.test/v1';
  e.AMD_LLM_KEY = 'private';
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(Response.json({ model: QWEN_MODEL, data: [{ index: 0, embedding: vector() }] })),
  );
  expect((await embeddingService(e, cache()).embed(['a'], 'document'))[0]).toHaveLength(1024);
  expect(e.AI.run).not.toHaveBeenCalled();
  const failed = env();
  failed.AMD_EMBED_BASE_URL = 'not-a-url';
  failed.AMD_LLM_KEY = 'private';
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('down', { status: 503 })));
  expect((await embeddingService(failed, cache()).embed(['a'], 'document'))[0]).toHaveLength(1024);
  expect(failed.AI.run).toHaveBeenCalledOnce();
});
