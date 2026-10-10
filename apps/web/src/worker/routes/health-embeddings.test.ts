import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { z } from 'zod';
const HealthResult = z.object({
  checks: z.record(z.string(), z.object({ ok: z.boolean(), detail: z.string().optional() })),
});
import type { Db } from '@hakit/db';
import type { AppEnv } from '../lib/context';
import type { Env } from '../env';
import { health } from './health';
import { QWEN_MODEL } from '../services/embeddings';
function setup() {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('mocks', false);
    c.set('db', () => ({ execute: async () => ({ rows: [{ extversion: 'test' }] }) }) as unknown as Db);
    await next();
  });
  app.route('/', health);
  const env = {
    HF_TOKEN: 'private-hf-test-token',
    EMBED_MODEL: QWEN_MODEL,
    EMBED_DIM: '1024',
    JOBS: { send: vi.fn() },
    PROJECT_ROOM: { idFromName: () => 'health', get: () => ({ broadcast: async () => 1 }) },
  } as unknown as Env;
  return { app, env };
}
afterEach(() => vi.unstubAllGlobals());
describe('HF embedding health probe', () => {
  it('uses the implemented routed provider and checks the vector', async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        model: QWEN_MODEL,
        data: [{ index: 0, embedding: Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0)) }],
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const { app, env } = setup();
    const response = await app.request('/health/deep', {}, env);
    expect(HealthResult.parse(await response.json()).checks.hf_embed).toEqual({
      ok: true,
      detail: 'dim 1024',
    });
    expect(fetch.mock.calls[0]![0]).toBe('https://router.huggingface.co/deepinfra/v1/openai/embeddings');
  });
  it('reports provider failure without returning its body or token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('private-hf-test-token private prompt', { status: 401 })),
    );
    const { app, env } = setup();
    const response = await app.request('/health/deep', {}, env);
    const body = HealthResult.parse(await response.json());
    expect(body.checks.hf_embed!.ok).toBe(false);
    expect(JSON.stringify(body)).not.toContain('private-hf-test-token');
  });
  it('reports incorrect vector dimensions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ data: [{ index: 0, embedding: [1, 2] }] })),
    );
    const { app, env } = setup();
    const response = await app.request('/health/deep', {}, env);
    expect(HealthResult.parse(await response.json()).checks.hf_embed!.ok).toBe(false);
  });
});
