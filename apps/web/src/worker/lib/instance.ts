/**
 * Configuration a self-hosted instance works out for itself, so a fresh deploy needs only its two secrets:
 * the public URL defaults to the origin requests arrive on, and the GitHub App created at /setup is read from
 * `instance_settings` (encrypted with TOKEN_ENC_KEY). Values set in wrangler vars or secrets always win.
 */
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { createDb, schema, type Db } from '@hakit/db';
import { isMock, type Env } from '../env';
import { decrypt, encrypt, importEncKey } from './crypto';

export const GITHUB_APP_KEY = 'github_app';

export const StoredGithubApp = z.object({
  appId: z.string(),
  slug: z.string(),
  clientId: z.string(),
  clientSecret: z.string(),
  webhookSecret: z.string(),
  /** PKCS#8 PEM. */
  privateKey: z.string(),
  /** Origin the App's callback and webhook URLs point at. */
  appUrl: z.string().url(),
  /** Account the App was created on, for the setup page. */
  ownerLogin: z.string().nullable(),
});
export type StoredGithubApp = z.infer<typeof StoredGithubApp>;

/** Positive results only: an instance that isn't set up yet must see the App the moment /setup stores it. */
let cached: StoredGithubApp | null = null;

/** Test hook: forget the cached App. */
export const resetInstanceCache = () => {
  cached = null;
};

export async function loadGithubApp(db: Db, encKey: string | undefined): Promise<StoredGithubApp | null> {
  if (cached) return cached;
  const [row] = await db
    .select({ valueEnc: schema.instanceSettings.valueEnc })
    .from(schema.instanceSettings)
    .where(eq(schema.instanceSettings.key, GITHUB_APP_KEY));
  if (!row) return null;
  const key = await importEncKey(encKey);
  cached = StoredGithubApp.parse(JSON.parse(await decrypt(key, row.valueEnc)));
  return cached;
}

/** Store the App once. Returns false when another request stored one first. */
export async function saveGithubApp(db: Db, encKey: string | undefined, app: StoredGithubApp) {
  const key = await importEncKey(encKey);
  const rows = await db
    .insert(schema.instanceSettings)
    .values({ key: GITHUB_APP_KEY, valueEnc: await encrypt(key, JSON.stringify(app)) })
    .onConflictDoNothing()
    .returning({ key: schema.instanceSettings.key });
  if (rows.length) cached = app;
  return rows.length > 0;
}

/** True when the GitHub App comes from wrangler vars/secrets rather than /setup. */
export const githubFromEnv = (env: Env) => Boolean(env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY);

/**
 * The env every handler sees. `origin` is the incoming request's origin (absent for queue and cron runs, which
 * fall back to the URL recorded at setup). A stored App that can't be read (TOKEN_ENC_KEY changed) is logged
 * and treated as missing, so /api/v1/health/deep shows GitHub red instead of every request failing.
 */
export async function resolveEnv(env: Env, origin?: string, db?: Db): Promise<Env> {
  const out: Env = { ...env, APP_URL: env.APP_URL || origin || '' };
  if (isMock(env) || githubFromEnv(env)) return out;
  let app: StoredGithubApp | null = null;
  try {
    app = await loadGithubApp(db ?? createDb(env.DB).db, env.TOKEN_ENC_KEY);
  } catch (err) {
    console.error(
      JSON.stringify({ level: 'error', msg: 'stored GitHub App unreadable', error: String(err) }),
    );
  }
  if (!app) return out;
  return {
    ...out,
    APP_URL: out.APP_URL || app.appUrl,
    GITHUB_APP_ID: app.appId,
    GITHUB_APP_SLUG: app.slug,
    GITHUB_CLIENT_ID: app.clientId,
    GITHUB_CLIENT_SECRET: app.clientSecret,
    GITHUB_WEBHOOK_SECRET: app.webhookSecret,
    GITHUB_APP_PRIVATE_KEY: app.privateKey,
  };
}
