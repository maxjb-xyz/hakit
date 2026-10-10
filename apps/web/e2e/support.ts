/**
 * E2E helpers (T-701): a contract-typed API client over Playwright's request context, the two run modes, and the
 * "pending task" convention that lets the happy path run today and tighten as each workstream merges.
 */
import { createHmac, randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import {
  API_PREFIX,
  buildPath,
  endpoints,
  type EndpointBody,
  type EndpointName,
  type EndpointParams,
  type EndpointQuery,
  type EndpointResponse,
} from '@hakit/contracts';

/**
 * Real mode: E2E_LOGIN_SECRET set → sign in through POST /auth/test-login against a real-mode server (preview, or
 * local with a database). Mock mode (default): the local `vite dev` server with HAKIT_MOCKS=1 serves fixtures.
 */
export const REAL = !!process.env.E2E_LOGIN_SECRET;

/** A step whose real implementation belongs to another task. Recorded on the report and in the test output. */
export class Pending extends Error {
  constructor(
    readonly taskId: string,
    readonly endpoint: string,
  ) {
    super(`${endpoint} is pending ${taskId}`);
  }
}

/** Notes why a step took a fallback path, so the report shows how much of the path is real. */
export function notePending(p: Pending) {
  test.info().annotations.push({ type: 'pending', description: `${p.endpoint}: ${p.taskId} not merged yet` });
}

type Args<N extends EndpointName> = {
  params?: EndpointParams<N>;
  body?: EndpointBody<N>;
  query?: EndpointQuery<N>;
};

function url(name: EndpointName, args: { params?: unknown; query?: unknown }) {
  let u = API_PREFIX + buildPath(endpoints[name].path, (args.params ?? {}) as Record<string, string>);
  const qs = new URLSearchParams(
    Object.entries((args.query ?? {}) as Record<string, unknown>)
      .filter(([, v]) => v != null)
      .map(([k, v]) => [k, String(v)]),
  );
  if ([...qs].length) u += `?${qs}`;
  return u;
}

async function send(ctx: APIRequestContext, name: EndpointName, args: Args<EndpointName>) {
  const def = endpoints[name];
  return ctx.fetch(url(name, args), {
    method: def.method,
    headers: { 'content-type': 'application/json', 'x-requested-with': 'hakit' },
    data: 'body' in def ? (args.body ?? {}) : undefined,
  });
}

/** 501 means another task owns the real handler: surface its id instead of failing the run. */
async function pendingFrom(name: EndpointName, res: APIResponse) {
  if (res.status() !== 501) return null;
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  const taskId = /T-\d{3}/.exec(body?.error?.message ?? '')?.[0] ?? 'another task';
  return new Pending(taskId, name);
}

/** Call a JSON endpoint; assert 2xx and validate the response against the contract schema. */
export async function call<N extends EndpointName>(
  ctx: APIRequestContext,
  name: N,
  args: Args<N> = {},
): Promise<EndpointResponse<N>> {
  const res = await send(ctx, name, args as Args<EndpointName>);
  const pending = await pendingFrom(name, res);
  if (pending) throw pending;
  expect(res.status(), `${name} → ${res.status()}: ${await res.text()}`).toBeLessThan(300);
  const def = endpoints[name];
  const json: unknown = await res.json();
  return ('response' in def ? def.response.parse(json) : json) as EndpointResponse<N>;
}

/** Call an SSE endpoint and return its events, each validated against the contract's event schema. */
export async function stream<N extends EndpointName>(ctx: APIRequestContext, name: N, args: Args<N> = {}) {
  const res = await send(ctx, name, args as Args<EndpointName>);
  const pending = await pendingFrom(name, res);
  if (pending) throw pending;
  expect(res.status(), `${name} → ${res.status()}`).toBe(200);
  const def = endpoints[name];
  const schema = (def as { event?: { parse(data: unknown): unknown } }).event;
  return (await res.text())
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => {
      const data: unknown = JSON.parse(line.slice(5).trim());
      return schema ? schema.parse(data) : data;
    }) as Array<{ type: string } & Record<string, unknown>>;
}

/** Run `step`; when it hits an endpoint another task hasn't shipped, note it and run `fallback` instead. */
export async function orFallback<T>(
  step: () => Promise<T>,
  fallback: (p: Pending) => Promise<T>,
): Promise<T> {
  try {
    return await step();
  } catch (e) {
    if (!(e instanceof Pending)) throw e;
    notePending(e);
    return fallback(e);
  }
}

/** Skip the rest of a test when its subject is still pending (no meaningful fallback exists). */
export async function orSkip<T>(step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (e) {
    if (!(e instanceof Pending)) throw e;
    notePending(e);
    test.skip(true, e.message);
    throw e;
  }
}

/** POST a GitHub webhook signed like GitHub does (HMAC-SHA256 over the raw body). */
export function postWebhook(
  ctx: APIRequestContext,
  event: string,
  payload: unknown,
  deliveryId = randomUUID(),
) {
  const raw = JSON.stringify(payload);
  const secret = process.env.E2E_WEBHOOK_SECRET ?? 'mock-mode-accepts-any-signature';
  const signature = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
  return ctx.post('/webhooks/github', {
    headers: {
      'content-type': 'application/json',
      'x-github-event': event,
      'x-github-delivery': deliveryId,
      'x-hub-signature-256': signature,
    },
    data: raw,
  });
}

/** Sign in as a (test) GitHub user through the E2E login route; the context keeps the session cookie. */
export async function testLogin(ctx: APIRequestContext, githubUserId: number, login: string) {
  const res = await ctx.post(`${API_PREFIX}/auth/test-login`, {
    headers: { 'x-e2e-secret': process.env.E2E_LOGIN_SECRET ?? '' },
    data: { githubUserId, login, name: login },
  });
  expect(res.status(), `test-login → ${res.status()}: ${await res.text()}`).toBe(200);
  return ((await res.json()) as { userId: string }).userId;
}
