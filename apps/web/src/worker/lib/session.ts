/**
 * Hakit sessions (ARCHITECTURE §11): random 32-byte token in the `hakit_session` cookie, only its SHA-256 stored,
 * 14-day sliding expiry. Owner: PL (T-201).
 */
import { and, eq, gt } from 'drizzle-orm';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { schema, type Db } from '@hakit/db';
import type { AppEnv, SessionUser } from './context';
import { randomToken, sha256Hex } from './crypto';

export const SESSION_COOKIE = 'hakit_session';
export const SESSION_TTL_MS = 14 * 24 * 3600 * 1000;
/** Extend at most once a day so reads don't write on every request. */
const SLIDE_AFTER_MS = 24 * 3600 * 1000;

const secure = (c: Context<AppEnv>) => !c.env.APP_URL.startsWith('http://localhost');

export async function createSession(db: Db, userId: string, userAgent: string | null, now: Date) {
  const token = randomToken();
  await db.insert(schema.sessions).values({
    id: await sha256Hex(token),
    userId,
    userAgent: userAgent?.slice(0, 256) ?? null,
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
  });
  return token;
}

export async function loadSession(db: Db, token: string, now: Date): Promise<SessionUser | null> {
  const id = await sha256Hex(token);
  const [row] = await db
    .select({
      id: schema.users.id,
      githubLogin: schema.users.githubLogin,
      expiresAt: schema.sessions.expiresAt,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.id, id), gt(schema.sessions.expiresAt, now)))
    .limit(1);
  if (!row) return null;
  if (row.expiresAt.getTime() - now.getTime() < SESSION_TTL_MS - SLIDE_AFTER_MS) {
    await db
      .update(schema.sessions)
      .set({ expiresAt: new Date(now.getTime() + SESSION_TTL_MS) })
      .where(eq(schema.sessions.id, id));
  }
  return { id: row.id, githubLogin: row.githubLogin };
}

export async function deleteSession(db: Db, token: string) {
  await db.delete(schema.sessions).where(eq(schema.sessions.id, await sha256Hex(token)));
}

export const readSessionCookie = (c: Context<AppEnv>) => getCookie(c, SESSION_COOKIE);

export function setSessionCookie(c: Context<AppEnv>, token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: secure(c),
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export const clearSessionCookie = (c: Context<AppEnv>) =>
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: secure(c) });
