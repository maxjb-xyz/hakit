import type { Context } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';
import { z } from 'zod';
import { Id } from '@hakit/contracts';
import type { AppEnv } from '../../lib/context';
import { HttpError, unauthorized } from '../../lib/errors';
import { githubUserToken } from '../../lib/github-token';
import { requireWorkspaceMember, saveInstallation } from './connections';

const cookieName = 'hakit_github_install';
const cookiePath = '/api/v1/auth/github/setup';
const stateSchema = z.object({
  nonce: z.string().min(32),
  userId: Id,
  workspaceId: Id,
  expiresAt: z.number(),
});
function stateSecret(c: Context<AppEnv>) {
  if (!c.env.SESSION_SECRET || c.env.SESSION_SECRET.length < 32)
    throw new HttpError(503, 'session_secret_missing', 'Installation security is not configured');
  return c.env.SESSION_SECRET;
}

export async function installationUrl(c: Context<AppEnv>, workspaceId: string) {
  if (!c.var.user) throw unauthorized();
  await requireWorkspaceMember(c.var.db(), c.var.user.id, workspaceId);
  if (!c.env.GITHUB_APP_SLUG) throw new HttpError(503, 'github_app_missing', 'GitHub App is not configured');
  const nonce = [...crypto.getRandomValues(new Uint8Array(32))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  await setSignedCookie(
    c,
    cookieName,
    JSON.stringify({ nonce, userId: c.var.user.id, workspaceId, expiresAt: Date.now() + 600_000 }),
    stateSecret(c),
    {
      path: cookiePath,
      httpOnly: true,
      sameSite: 'Lax',
      secure: new URL(c.env.APP_URL).protocol === 'https:',
      maxAge: 600,
    },
  );
  c.header('Cache-Control', 'no-store');
  return { url: c.var.services.github.installUrl(nonce) };
}

export async function installationSetup(c: Context<AppEnv>): Promise<Response> {
  if (c.var.mocks) return c.redirect('/');
  if (!c.var.user) throw unauthorized();
  const query = z
    .object({
      installation_id: z
        .string()
        .regex(/^[1-9]\d*$/)
        .transform(Number)
        .refine(Number.isSafeInteger),
      state: z.string().min(32),
      setup_action: z.enum(['install', 'update']).optional(),
    })
    .safeParse(c.req.query());
  if (!query.success) throw new HttpError(400, 'invalid_installation', 'Invalid installation return URL');
  const signed = await getSignedCookie(c, stateSecret(c), cookieName);
  let parsed: unknown;
  try {
    parsed = typeof signed === 'string' ? JSON.parse(signed) : null;
  } catch {
    parsed = null;
  }
  const state = stateSchema.safeParse(parsed);
  if (
    !state.success ||
    state.data.nonce !== query.data.state ||
    state.data.userId !== c.var.user.id ||
    state.data.expiresAt <= Date.now()
  )
    throw new HttpError(400, 'invalid_state', 'Start the repository installation again');
  deleteCookie(c, cookieName, { path: cookiePath });
  const db = c.var.db();
  await requireWorkspaceMember(db, c.var.user.id, state.data.workspaceId);
  const token = await githubUserToken(db, c.var.user.id, c.env.TOKEN_ENC_KEY, c.var.services.github);
  const installation = (await c.var.services.github.listInstallations(token)).find(
    (i) => i.id === query.data.installation_id && i.suspended_at === null,
  );
  if (!installation)
    throw new HttpError(
      404,
      'installation_not_found',
      'Installation is not accessible to your GitHub account',
    );
  await saveInstallation(db, installation);
  c.header('Cache-Control', 'no-store');
  return c.redirect(`/w/${state.data.workspaceId}/code`);
}
