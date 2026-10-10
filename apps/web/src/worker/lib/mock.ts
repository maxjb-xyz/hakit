import type { Context } from 'hono';
import type { AppEnv } from './context';
import { notImplemented } from './errors';

/**
 * Scaffold helper: return `fixture()` in mock mode, otherwise 501 naming the task that implements it.
 * Owners delete the mockOr() call when they implement the real handler (keep a fixture branch for tests if useful).
 */
export function mockOr<T>(c: Context<AppEnv>, taskId: string, fixture: () => T): T {
  if (c.var.mocks) return fixture();
  throw notImplemented(taskId);
}
