import { Hono } from 'hono';
import { expect, it, vi } from 'vitest';
import type { AppEnv } from '../lib/context';
import type { Env } from '../env';

const close = vi.fn(async () => {});
vi.mock('@hakit/db', () => ({ createDb: () => ({ db: {}, ready: Promise.resolve(), close }) }));
const { base } = await import('./base');

it('keeps the request DB client open until a streamed response has finished', async () => {
  let finish!: () => void;
  const pending: Promise<unknown>[] = [];
  const app = new Hono<AppEnv>();
  app.use('*', base());
  app.get('/stream', (c) => {
    c.var.db();
    c.set('streamDone', new Promise<void>((resolve) => (finish = resolve)));
    return c.text('streaming');
  });
  const env = { HAKIT_MOCKS: '0', HYPERDRIVE: { connectionString: 'postgres://x' } } as unknown as Env;
  const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException: () => {} };
  await app.request('/stream', {}, env, ctx as unknown as ExecutionContext);
  await new Promise((r) => setTimeout(r, 0));
  expect(close).not.toHaveBeenCalled();
  finish();
  await Promise.all(pending);
  expect(close).toHaveBeenCalledOnce();
});
