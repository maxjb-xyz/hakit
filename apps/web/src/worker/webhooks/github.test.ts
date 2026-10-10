import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Db } from '@hakit/db';
import type { AppEnv } from '../lib/context';
import type { Env } from '../env';
import { HttpError } from '../lib/errors';
import { getServices } from '../services';
import { verifyWebhook } from '../services/github';
import { githubWebhook } from './github';

const secret = 'test-webhook-secret';
const sign = (body: string) => 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');

function setup() {
  const deliveries = new Set<string>();
  const send = vi.fn().mockResolvedValue(undefined);
  const insert = vi.fn();
  // Models commit/rollback without connecting to the shared database.
  const db = {
    transaction: async (run: (tx: unknown) => Promise<boolean>) => {
      let pending: string | undefined;
      const result = await run({
        insert: (table: unknown) => {
          insert(table);
          return {
            values: ({ deliveryId }: { deliveryId: string }) => ({
              onConflictDoNothing: () => ({
                returning: async () => {
                  if (deliveries.has(deliveryId)) return [];
                  pending = deliveryId;
                  return [{ deliveryId }];
                },
              }),
            }),
          };
        },
      });
      if (pending) deliveries.add(pending);
      return result;
    },
  } as unknown as Db;
  const env = { HAKIT_MOCKS: '0', GITHUB_WEBHOOK_SECRET: secret, JOBS: { send } } as unknown as Env;
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('mocks', false);
    c.set('services', getServices(env));
    c.set('db', () => db);
    await next();
  });
  app.onError((err, c) =>
    c.json(
      { error: err instanceof HttpError ? err.code : 'internal' },
      err instanceof HttpError ? err.status : 500,
    ),
  );
  app.route('/', githubWebhook);
  const call = (body = '{"ref":"refs/heads/hk-12-café"}', headers: Record<string, string> = {}) =>
    app.request(
      '/webhooks/github',
      {
        method: 'POST',
        body,
        headers: {
          'x-hub-signature-256': sign(body),
          'x-github-delivery': 'delivery-1',
          'x-github-event': 'push',
          ...headers,
        },
      },
      env,
    );
  return { call, send, insert, deliveries };
}

describe('GitHub signature verification', () => {
  it('matches the published GitHub test vector', async () => {
    expect(
      await verifyWebhook(
        "It's a Secret to Everybody",
        'Hello, World!',
        'sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17',
      ),
    ).toBe(true);
  });
  it('verifies UTF-8 and rejects modified raw bodies', async () => {
    const raw = '{ "message": "café 🚀" }';
    expect(await verifyWebhook(secret, raw, sign(raw))).toBe(true);
    expect(await verifyWebhook(secret, raw + ' ', sign(raw))).toBe(false);
    expect(await verifyWebhook('wrong', raw, sign(raw))).toBe(false);
  });
  it.each([null, '', 'sha1=abc', 'sha256=zz', 'sha256=' + 'g'.repeat(64)])(
    'rejects missing or malformed signature %s',
    async (signature) => {
      expect(await verifyWebhook(secret, '{}', signature)).toBe(false);
    },
  );
  it('fails closed without a secret', async () => {
    expect(await verifyWebhook(undefined, '{}', sign('{}'))).toBe(false);
  });
});

describe('GitHub webhook ingestion (real mode, mocked bindings)', () => {
  it('records and queues a validated delivery', async () => {
    const { call, send, deliveries } = setup();
    expect((await call()).status).toBe(202);
    expect(deliveries.has('delivery-1')).toBe(true);
    expect(send).toHaveBeenCalledExactlyOnceWith({
      type: 'github.webhook',
      deliveryId: 'delivery-1',
      event: 'push',
      payload: { ref: 'refs/heads/hk-12-café' },
    });
  });
  it('returns 200 for a duplicate without a second job', async () => {
    const { call, send } = setup();
    await call();
    const response = await call();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ duplicate: true });
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('rejects a bad signature before parsing JSON or accessing the database', async () => {
    const { call, send, insert } = setup();
    expect((await call('not JSON', { 'x-hub-signature-256': sign('{}') })).status).toBe(401);
    expect(send).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });
  it('ignores unknown events with 202 and no database or queue work', async () => {
    const { call, send, insert } = setup();
    expect((await call('{}', { 'x-github-event': 'ping' })).status).toBe(202);
    expect(send).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });
  it.each(['not JSON', 'null', '[]', '42'])('rejects invalid payload %s', async (raw) => {
    const { call, send, insert } = setup();
    expect((await call(raw)).status).toBe(400);
    expect(send).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });
  it.each(['x-github-delivery', 'x-github-event'])('rejects empty %s', async (header) => {
    const { call, send } = setup();
    expect((await call('{}', { [header]: '' })).status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });
  it('allows retry after queue failure by rolling back the delivery claim', async () => {
    const { call, send, deliveries } = setup();
    send.mockRejectedValueOnce(new Error('queue unavailable'));
    expect((await call()).status).toBe(500);
    expect(deliveries.size).toBe(0);
    expect((await call()).status).toBe(202);
    expect(deliveries.has('delivery-1')).toBe(true);
  });
});
