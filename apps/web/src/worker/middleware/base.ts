import type { MiddlewareHandler } from 'hono';
import { createDb, type Db } from '@hakit/db';
import type { AppEnv } from '../lib/context';
import { isMock } from '../env';
import { getServices, type Services } from '../services';
import { HttpError } from '../lib/errors';

export interface BaseOptions {
  /** Tests inject an in-memory DB (test/pglite.ts) to exercise real-mode handlers. */
  db?: Db;
  /** Tests stub GitHub et al. while keeping real-mode routes. */
  services?: Partial<Services>;
}

/** Request id, mock flag, services, and a lazy per-request DB client (Hyperdrive). */
export const base =
  (opts: BaseOptions = {}): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    c.set('requestId', c.req.header('cf-ray') ?? crypto.randomUUID());
    const mocks = isMock(c.env);
    c.set('mocks', mocks);
    c.set('services', { ...getServices(c.env), ...opts.services });
    c.set('user', null);
    c.set('role', null);

    let handle: ReturnType<typeof createDb> | null = null;
    c.set('db', () => {
      if (mocks)
        throw new HttpError(
          500,
          'db_in_mock_mode',
          'DB is not available in mock mode; return fixtures instead',
        );
      if (opts.db) return opts.db;
      if (!handle) handle = createDb(c.env.HYPERDRIVE.connectionString);
      return handle.db;
    });

    await next();

    if (handle) {
      const h = handle as ReturnType<typeof createDb>;
      c.executionCtx.waitUntil(h.ready.then(() => h.close()).catch(() => {}));
    }
  };
