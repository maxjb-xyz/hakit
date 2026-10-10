import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

export * as schema from './schema';
export { EMBED_DIM } from './schema';

export type Db = ReturnType<typeof createDb>['db'];

/**
 * Create a Drizzle client. In the Worker pass `env.HYPERDRIVE.connectionString` and create one
 * client per request (Hyperdrive pools for you); call `close()` in `ctx.waitUntil` when done.
 */
export function createDb(connectionString: string) {
  const client = new pg.Client({ connectionString });
  const ready = client.connect();
  const db = drizzle(client, { schema });
  return {
    db,
    ready,
    close: () => client.end(),
  };
}
