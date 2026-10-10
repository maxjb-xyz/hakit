/**
 * Mock-mode contract smoke test: every registered JSON endpoint responds 2xx and its body satisfies the
 * response schema. Runs in Node (no workerd); bindings are stubbed. Real-mode tests live next to each route.
 */
import { describe, expect, it } from 'vitest';
import { API_PREFIX, buildPath, endpoints } from '@hakit/contracts';
import { ids } from '@hakit/contracts/fixtures';
import { createApp } from './app';
import type { Env } from './env';

const env = {
  HAKIT_MOCKS: '1',
  APP_URL: 'http://localhost:5173',
  EMBED_DIM: '1024',
  EMBED_MODEL: 'mock',
  GEMINI_MODEL_PLAN: 'mock',
  GEMINI_MODEL_FAST: 'mock',
} as unknown as Env;
const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
  props: {},
} as unknown as ExecutionContext;

const params: Record<string, string> = {
  wid: ids.workspace,
  uid: ids.users.priya,
  pid: ids.project,
  planId: ids.plan,
  tid: ids.task(4),
  depId: ids.task(1),
  eid: ids.activity(1),
  rid: ids.rec(1),
  iid: '12000000-0000-4000-8000-000000000001',
  id: ids.session(1),
  code: 'ORBIT7K2QX',
  slug: 'cloudflare-workers',
};
const bodies: Partial<Record<keyof typeof endpoints, unknown>> = {
  createWorkspace: { name: 'Team Orbit' },
  createInvite: {},
  upsertSkill: { level: 4 },
  createProject: { name: 'Hakit' },
  putConstraints: { constraints: [] },
  submitIdea: { title: 'x', pitch: 'y' },
  patchPlan: { ops: [] },
  createTask: { title: 'New task' },
  updateTask: { status: 'done' },
  manualAssign: { userId: ids.users.sam },
  acceptAssignments: { assignmentIds: [ids.assignment(1)] },
  createRepo: { name: 'hakit' },
  connectRepo: { repoId: 987654321 },
  linkActivity: { taskId: ids.task(2) },
  mapAuthor: { raw: 'x@example.com', userId: ids.users.jae },
  createAgentToken: { name: 'laptop' },
  linkAgentSession: { taskId: ids.task(8) },
};
const queries: Partial<Record<keyof typeof endpoints, string>> = {
  installUrl: '?workspaceId=' + ids.workspace,
  searchSkills: '?q=cloud',
};

const app = createApp();
const call = (method: string, path: string, body?: unknown) =>
  app.request(
    API_PREFIX + path,
    {
      method,
      headers: { 'content-type': 'application/json', 'x-requested-with': 'hakit' },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env,
    ctx,
  );

describe('mock-mode API satisfies contracts', () => {
  const jsonEndpoints = Object.entries(endpoints).filter(([, d]) => !('kind' in d && d.kind === 'sse'));
  it.each(jsonEndpoints)('%s', async (name, def) => {
    const path = buildPath(def.path, params) + (queries[name as keyof typeof endpoints] ?? '');
    const body =
      def.method === 'GET' || def.method === 'DELETE'
        ? undefined
        : (bodies[name as keyof typeof endpoints] ?? {});
    const res = await call(def.method, path, body);
    const json = await res.json();
    expect(res.status, JSON.stringify(json)).toBeLessThan(300);
    if ('response' in def && def.response) expect(() => def.response.parse(json)).not.toThrow();
  });

  it('streams plan generation events', async () => {
    const res = await call('POST', buildPath(endpoints.generatePlan.path, params), { ideaId: params.iid });
    const text = await res.text();
    expect(text).toContain('event: outline');
    expect(text).toContain('event: done');
  });

  it('lists plan versions newest first, with a draft the review screen can edit', async () => {
    const list = endpoints.listPlans.response.parse(
      await (await call('GET', buildPath(endpoints.listPlans.path, params))).json(),
    );
    expect(list.map((p) => [p.version, p.status])).toEqual([
      [2, 'draft'],
      [1, 'accepted'],
    ]);
    const draft = endpoints.getPlan.response.parse(
      await (await call('GET', buildPath(endpoints.getPlan.path, { ...params, planId: list[0]!.id }))).json(),
    );
    expect(draft.status).toBe('draft');
    expect(draft.feasibility.cutTaskKeys.length).toBe(list[0]!.cutTaskCount);
  });

  it('filters activity by source', async () => {
    const page = async (q: string) =>
      endpoints.listActivity.response.parse(
        await (await call('GET', buildPath(endpoints.listActivity.path, params) + q)).json(),
      ).items;
    const all = await page('');
    const agent = await page('?source=agent');
    expect(agent.length).toBeGreaterThan(0);
    expect(agent.every((e) => e.source === 'agent')).toBe(true);
    expect((await page('?source=github')).length + agent.length).toBe(all.length);
    expect((await call('GET', buildPath(endpoints.listActivity.path, params) + '?source=x')).status).toBe(
      400,
    );
  });

  it('rejects invalid bodies with 400', async () => {
    const res = await call('POST', '/workspaces', { name: '' });
    expect(res.status).toBe(400);
  });

  it('404s for other workspaces', async () => {
    const res = await call('GET', '/w/00000000-0000-4000-8000-000000000000');
    expect(res.status).toBe(404);
  });

  it('rejects mutations without the CSRF header', async () => {
    const res = await app.request(API_PREFIX + '/workspaces', { method: 'POST', body: '{}' }, env, ctx);
    expect(res.status).toBe(403);
  });
});
