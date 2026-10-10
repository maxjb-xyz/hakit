import type { MiddlewareHandler } from 'hono';
import { createDb } from '@hakit/db';
import type { AppEnv } from '../lib/context';
import { isMock } from '../env';
import { getServices } from '../services';
import { HttpError } from '../lib/errors';

/** Request id, mock flag, services, and a lazy per-request DB client (Hyperdrive). */
export const base: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set('requestId', c.req.header('cf-ray') ?? crypto.randomUUID());
  const mocks = isMock(c.env);
  c.set('mocks', mocks);
  c.set('services', getServices(c.env));
  c.set('user', null);

  let handle: ReturnType<typeof createDb> | null = null;
  c.set('db', () => {
    if (mocks)
      throw new HttpError(
        500,
        'db_in_mock_mode',
        'DB is not available in mock mode; return fixtures instead',
      );
    if (!handle) handle = createDb(c.env.HYPERDRIVE.connectionString);
    return handle.db;
  });

  await next();

  if (handle) {
    const h = handle as ReturnType<typeof createDb>;
    c.executionCtx.waitUntil(h.ready.then(() => h.close()).catch(() => {}));
  }
};
