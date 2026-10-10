import type { Role } from '@hakit/contracts';
import type { Db } from '@hakit/db';
import type { Env } from '../env';
import type { Services } from '../services';

export interface SessionUser {
  id: string;
  githubLogin: string;
}

/** Hono generics for every route: c.env, c.var.* */
export interface AppEnv {
  Bindings: Env;
  Variables: {
    requestId: string;
    mocks: boolean;
    services: Services;
    /** Lazily created per request; closed in waitUntil. Throws in mock mode. */
    db: () => Db;
    user: SessionUser | null;
    /** Set by requireMember for /w/:wid/* routes. */
    role: Role | null;
  };
}
