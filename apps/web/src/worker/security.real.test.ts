/**
 * T-702 security tests (RISKS §2), in real mode on in-memory PGlite:
 * - authZ matrix: anonymous / non-member / member / owner over EVERY endpoint in the contract registry
 * - CSRF header on cookie-auth mutations (S-9)
 * - webhook signature verification (S-3)
 * - agent token revocation (S-6)
 * - no secrets, tokens or prompts in logs: a static grep over worker sources and a runtime capture (S-1)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildPath, endpoints, type EndpointName } from '@hakit/contracts';
import { planDocument } from '@hakit/contracts/fixtures';
import { schema } from '@hakit/db';
import { createApp } from './app';
import { authenticateAgentToken } from './lib/agent-token';
import { verifyWebhook } from './services/github';
import { createHarness, GHO, GHR } from './test/harness';

let h: Awaited<ReturnType<typeof createHarness>>;
const who: Record<'owner' | 'member' | 'outsider', { id: string; token: string }> = {} as never;
const params: Record<string, string> = {};

/** Endpoints with no workspace/project scope: any signed-in user (or anyone, if public) may call them. */
const GLOBAL: EndpointName[] = [
  'me',
  'logout',
  'createWorkspace',
  'getHackathon',
  'previewInvite',
  'acceptInvite',
  'aiStatus',
  'installUrl',
  // The caller's own data: their skills and the GitHub repos their own token can see.
  'upsertSkill',
  'removeSkill',
  'searchSkills',
  'listRepos',
  'createRepo',
];
/** No session needed (app.ts PUBLIC). Logout without a session is a harmless no-op. */
const PUBLIC: EndpointName[] = ['previewInvite', 'logout'];
/** Owner-only routes (assertOwner). */
const OWNER_ONLY: EndpointName[] = ['updateWorkspace'];

beforeAll(async () => {
  h = await createHarness();
  who.owner = await h.signIn(1, 'owner');
  who.member = await h.signIn(2, 'member');
  who.outsider = await h.signIn(3, 'outsider');
  const w = await h.call('/workspaces', {
    method: 'POST',
    token: who.owner.token,
    json: { name: 'Secure', startsAt: '2000-01-01T00:00:00Z', deadlineAt: '2099-01-01T00:00:00Z' },
  });
  const wid = ((await w.json()) as { id: string }).id;
  await h.db.insert(schema.memberships).values({ workspaceId: wid, userId: who.member.id, role: 'member' });
  await h.db.insert(schema.memberProfiles).values({ workspaceId: wid, userId: who.member.id });
  const [p] = await h.db.insert(schema.projects).values({ workspaceId: wid, name: 'P' }).returning();
  const [plan] = await h.db
    .insert(schema.plans)
    .values({ projectId: p!.id, version: 1, payload: planDocument, feasibility: {}, model: 't' })
    .returning();
  const [t1, t2] = await h.db
    .insert(schema.tasks)
    .values([1, 2].map((number) => ({ projectId: p!.id, number, title: `T${number}` })))
    .returning();
  const [rec] = await h.db
    .insert(schema.recommendations)
    .values({
      projectId: p!.id,
      kind: 'check_in',
      severity: 'info',
      headline: 'h',
      rationale: 'r',
      actions: [{ op: 'notify', userId: who.member.id, message: 'hi' }],
      dedupeKey: 'k',
    })
    .returning();
  const [tok] = await h.db
    .insert(schema.agentTokens)
    .values({ userId: who.member.id, workspaceId: wid, name: 'x', tokenHash: 'f'.repeat(64) })
    .returning();
  const [sess] = await h.db
    .insert(schema.agentSessions)
    .values({
      externalSessionId: 's',
      userId: who.member.id,
      workspaceId: wid,
      projectId: p!.id,
      agent: 'claude_code',
    })
    .returning();
  const [ev] = await h.db
    .insert(schema.activityEvents)
    .values({ ts: new Date(), projectId: p!.id, source: 'github', kind: 'commit', title: 'c' })
    .returning();
  await h.db.insert(schema.invites).values({
    workspaceId: wid,
    code: 'SECURECODE',
    createdBy: who.owner.id,
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  Object.assign(params, {
    wid,
    pid: p!.id,
    planId: plan!.id,
    tid: t1!.id,
    depId: t2!.id,
    rid: rec!.id,
    uid: who.member.id,
    id: tok!.id,
    eid: ev!.id,
    sessionId: sess!.id,
    iid: '1',
    code: 'SECURECODE',
    slug: 'nope',
  });
}, 60_000);

afterEach(() => vi.restoreAllMocks());

function pathFor(name: EndpointName) {
  const d = endpoints[name];
  const names = [...d.path.matchAll(/:(\w+)/g)].map((m) => m[1]!);
  const p = Object.fromEntries(names.map((n) => [n, params[n]!]));
  if (d.path.startsWith('/agent-sessions/')) p.id = params.sessionId!;
  return buildPath(d.path, p);
}

const send = (name: EndpointName, token?: string, extra: RequestInit = {}) => {
  const d = endpoints[name];
  return h.call(pathFor(name), {
    method: d.method,
    token,
    json: d.method === 'GET' || d.method === 'DELETE' ? undefined : {},
    ...extra,
  });
};

const scoped = (Object.keys(endpoints) as EndpointName[]).filter((n) => !GLOBAL.includes(n));

describe('authZ matrix (S-4)', () => {
  it('covers every endpoint in the registry', () => {
    expect(scoped.length + GLOBAL.length).toBe(Object.keys(endpoints).length);
  });

  it.each(Object.keys(endpoints).filter((n) => !PUBLIC.includes(n as EndpointName)) as EndpointName[])(
    'anonymous → 401: %s',
    async (name) => {
      expect((await send(name)).status).toBe(401);
    },
  );

  it.each(scoped)('non-member is never served: %s', async (name) => {
    const res = await send(name, who.outsider.token);
    // 404 hides existence; route()/sseRoute() authorize before parsing input or opening a stream.
    expect(res.status, name).toBe(404);
  });

  it.each(OWNER_ONLY)('member → 403, owner → allowed: %s', async (name) => {
    const body = { name: 'Renamed' };
    expect((await send(name, who.member.token, { body: JSON.stringify(body) })).status).toBe(403);
    expect((await send(name, who.owner.token, { body: JSON.stringify(body) })).status).toBe(200);
  });

  it('members can read their workspace, project and board', async () => {
    for (const name of ['getWorkspace', 'listMembers', 'getProject', 'getBoard', 'missionControl'] as const)
      expect((await send(name, who.member.token)).status, name).toBe(200);
  });

  it('agent tokens are personal even inside one workspace', async () => {
    expect((await send('revokeAgentToken', who.owner.token)).status).toBe(404);
    const listed = (await (await send('listAgentTokens', who.owner.token)).json()) as unknown[];
    expect(listed).toEqual([]);
  });
});

describe('CSRF (S-9)', () => {
  it('rejects cookie-auth mutations without X-Requested-With', async () => {
    const json = { name: 'x', deadlineAt: '2099-01-01T00:00:00Z' };
    expect(
      (await h.call('/workspaces', { method: 'POST', token: who.owner.token, json, csrf: false })).status,
    ).toBe(403);
    expect(
      (
        await h.call('/workspaces', {
          method: 'POST',
          token: who.owner.token,
          json,
          csrf: false,
          headers: { 'x-requested-with': 'evil' },
        })
      ).status,
    ).toBe(403);
    expect((await h.call('/workspaces', { method: 'POST', token: who.owner.token, json })).status).toBe(200);
  });
});

describe('webhook signatures (S-3)', () => {
  const secret = 'whsec_test';
  const sign = (body: string) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

  it('accepts only an HMAC over the exact raw body', async () => {
    const body = JSON.stringify({ zen: 'Keep it logically awesome.' });
    expect(await verifyWebhook(secret, body, sign(body))).toBe(true);
    expect(await verifyWebhook(secret, `${body} `, sign(body))).toBe(false);
    expect(
      await verifyWebhook(
        secret,
        body,
        sign(body).replace(/.$/, (c) => (c === '0' ? '1' : '0')),
      ),
    ).toBe(false);
    expect(await verifyWebhook(secret, body, null)).toBe(false);
    expect(await verifyWebhook(secret, body, 'sha1=abc')).toBe(false);
    expect(await verifyWebhook(undefined, body, sign(body))).toBe(false);
  });

  it('rejects a forged delivery before parsing or enqueueing', async () => {
    h.github.verifyWebhook = (raw, sig) => verifyWebhook(secret, raw, sig);
    const sendCount = h.jobs.send.mock.calls.length;
    const res = await createApp({ db: h.db, services: { github: h.github } }).request(
      '/webhooks/github',
      {
        method: 'POST',
        headers: { 'x-hub-signature-256': sign('{}'), 'x-github-delivery': 'd1', 'x-github-event': 'push' },
        body: '{"forged":true}',
      },
      h.env,
      { waitUntil: () => {}, passThroughOnException: () => {}, props: {} } as unknown as ExecutionContext,
    );
    expect(res.status).toBe(401);
    expect(h.jobs.send.mock.calls.length).toBe(sendCount);
  });
});

describe('agent token revocation (S-6)', () => {
  it('a revoked token stops authenticating immediately', async () => {
    const created = (await (
      await h.call(`/w/${params.wid}/agent-tokens`, {
        method: 'POST',
        token: who.member.token,
        json: { name: 'r' },
      })
    ).json()) as { id: string; token: string };
    await expect(
      authenticateAgentToken(h.db, {}, `Bearer ${created.token}`, new Date()),
    ).resolves.toBeTruthy();
    await h.call(`/agent-tokens/${created.id}`, { method: 'DELETE', token: who.member.token });
    await expect(
      authenticateAgentToken(h.db, {}, `Bearer ${created.token}`, new Date()),
    ).rejects.toMatchObject({
      status: 401,
    });
  });
});

describe('outbound fetches', () => {
  const ROOT = fileURLToPath(new URL('.', import.meta.url));
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') && !p.includes('.test.') ? [p] : [];
    });

  // workerd rejects redirect: 'error' at call time; use 'manual' and treat any non-2xx as a failure.
  it("never use redirect: 'error', which Cloudflare Workers rejects", () => {
    const offenders = files(ROOT).filter((f) => /redirect:\s*['"]error['"]/.test(readFileSync(f, 'utf8')));
    expect(offenders.map((f) => f.slice(ROOT.length))).toEqual([]);
  });
});

describe('no secrets in logs (S-1)', () => {
  const ROOT = fileURLToPath(new URL('.', import.meta.url));
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') && !p.includes('.test.') ? [p] : [];
    });

  it('no console call in worker code mentions a token, secret, key, password, prompt or authorization', () => {
    const offenders: string[] = [];
    for (const f of files(ROOT)) {
      const src = readFileSync(f, 'utf8');
      // Each console.* call with its arguments (up to the closing paren of a JSON.stringify/obj literal).
      for (const m of src.matchAll(/console\.(log|info|warn|error|debug)\(([\s\S]*?)\);/g)) {
        if (/token|secret|password|prompt|authorization|api_?key|private_?key|cookie/i.test(m[2]!))
          offenders.push(`${f.slice(ROOT.length)}: ${m[0].replace(/\s+/g, ' ').slice(0, 120)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('sign-in, refresh failure and an unhandled error log nothing secret', async () => {
    const lines: string[] = [];
    for (const k of ['log', 'info', 'warn', 'error', 'debug'] as const)
      vi.spyOn(console, k).mockImplementation((...a: unknown[]) => void lines.push(a.map(String).join(' ')));
    const login = await h.call('/auth/github/login');
    const state = login.headers
      .getSetCookie()
      .find((c) => c.startsWith('hakit_oauth_state='))!
      .split(';')[0]!;
    const cb = await h.call(`/auth/github/callback?code=c&state=${state.split('=')[1]}`, {
      headers: { cookie: state },
    });
    const session = cb.headers
      .getSetCookie()
      .find((c) => c.startsWith('hakit_session='))!
      .split(';')[0]!
      .split('=')[1]!;
    vi.mocked(h.github.exchangeCode).mockRejectedValueOnce(new Error(`boom ${GHO}`));
    await h.call(`/auth/github/callback?code=c&state=s`, { headers: { cookie: 'hakit_oauth_state=s' } });
    const joined = lines.join('\n');
    for (const secret of [GHO, GHR, session, h.env.TOKEN_ENC_KEY!])
      expect(joined.includes(secret), `leaked ${secret.slice(0, 6)}…`).toBe(false);
  });
});
