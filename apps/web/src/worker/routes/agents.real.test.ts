/** Real-mode agent ingestion, session state machine, linking, timeouts and session routes (T-602). */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { WsPayload } from '@hakit/contracts';
import { type AgentHookEvent, type AgentSession, type JobMessage } from '@hakit/contracts';
import { schema } from '@hakit/db';
import { processAgentEvent, sweepAgentSessions } from '../jobs/agent-event';
import { createHarness } from '../test/harness';

type AgentJob = Extract<JobMessage, { type: 'agent.event' }>;

let h: Awaited<ReturnType<typeof createHarness>>;
let owner: { id: string; token: string };
let mate: { id: string; token: string };
let wid: string;
let pid: string;
let token: string;
let tokenId: string;
let task7: string;
let task8: string;
const published: { projectId: string; payload: WsPayload }[] = [];
const publish = async (projectId: string, payload: WsPayload) => void published.push({ projectId, payload });

const T0 = Date.parse('2026-10-10T10:00:00Z');
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();
const ev = (hookEventName: string, min: number, extra: Partial<AgentHookEvent> = {}): AgentHookEvent => ({
  agent: 'claude_code',
  hookEventName,
  sessionId: 'cc-1',
  ts: at(min),
  repo: 'Team/Hakit',
  branch: 'main',
  ...extra,
});
const job = (event: AgentHookEvent): AgentJob => ({
  type: 'agent.event',
  tokenId,
  userId: mate.id,
  workspaceId: wid,
  event,
});
const handle = (event: AgentHookEvent) => processAgentEvent(job(event), h.db, publish);
const sessionRow = async () => (await h.db.select().from(schema.agentSessions))[0]!;

beforeEach(async () => {
  published.length = 0;
  h = await createHarness();
  owner = await h.signIn(1, 'priya');
  mate = await h.signIn(2, 'sam');
  const w = await h.call('/workspaces', {
    method: 'POST',
    token: owner.token,
    json: { name: 'Crew', startsAt: '2000-01-01T00:00:00Z', deadlineAt: '2099-01-01T00:00:00Z' },
  });
  wid = ((await w.json()) as { id: string }).id;
  await h.db
    .insert(schema.memberships)
    .values({ workspaceId: wid, userId: mate.id, role: 'member', colorIndex: 1 });
  const p = await h.call(`/w/${wid}/projects`, {
    method: 'POST',
    token: owner.token,
    json: { name: 'Hakit' },
  });
  pid = ((await p.json()) as { id: string }).id;
  await h.db
    .insert(schema.repos)
    .values({ id: 99, fullName: 'team/hakit', htmlUrl: 'https://github.com/team/hakit' });
  await h.db.insert(schema.projectRepos).values({ projectId: pid, repoId: 99 });
  const [t7, t8] = await h.db
    .insert(schema.tasks)
    .values([
      { projectId: pid, number: 7, title: 'Auth' },
      { projectId: pid, number: 8, title: 'Board', status: 'in_progress', startedAt: new Date(T0) },
    ])
    .returning();
  task7 = t7!.id;
  task8 = t8!.id;
  await h.db.insert(schema.assignments).values({
    taskId: task8,
    userId: mate.id,
    status: 'active',
    source: 'manual',
    score: 1,
    breakdown: {},
    explanation: 'x',
  });
  const res = await h.call(`/w/${wid}/agent-tokens`, {
    method: 'POST',
    token: mate.token,
    json: { name: 'l' },
  });
  ({ id: tokenId, token } = (await res.json()) as { id: string; token: string });
}, 30_000);

describe('POST /agent/events', () => {
  const post = (body: unknown, auth = `Bearer ${token}`) =>
    h.call('/agent/events', { method: 'POST', json: body, headers: { authorization: auth }, csrf: false });

  it('authenticates, minimizes per token flags and enqueues', async () => {
    const res = await post({ ...ev('SessionStart', 0), prompt: 'secret prompt', cwdHash: 'abc' });
    expect(res.status).toBe(202);
    expect(h.jobs.send).toHaveBeenCalledTimes(1);
    const sent = (vi.mocked(h.jobs.send).mock.calls[0] as unknown[])[0] as AgentJob;
    expect(sent).toMatchObject({ type: 'agent.event', tokenId, userId: mate.id, workspaceId: wid });
    expect(sent.event.prompt).toBeUndefined(); // sharePrompts defaults to false
    expect(sent.event.cwdHash).toBe('abc'); // sharePaths defaults to true
    expect(JSON.stringify(sent)).not.toContain(token);
  });

  it('rejects bad tokens before parsing, revoked tokens, and invalid events', async () => {
    expect((await post({}, 'Bearer hk_at_nope')).status).toBe(401);
    expect((await post(ev('Stop', 1), '')).status).toBe(401);
    expect((await post({ hookEventName: 'Stop' })).status).toBe(400);
    await h.call(`/agent-tokens/${tokenId}`, { method: 'DELETE', token: mate.token });
    expect((await post(ev('Stop', 1))).status).toBe(401);
    expect(h.jobs.send).not.toHaveBeenCalled();
  });
});

describe('agent.event job', () => {
  it('creates the session, maps the repo to the project and infers the in-progress task', async () => {
    await handle(ev('SessionStart', 0));
    const s = await sessionRow();
    expect(s).toMatchObject({
      status: 'active',
      projectId: pid,
      taskId: task8,
      linkKind: 'inferred',
      repoFullName: 'Team/Hakit',
    });
    const types = published.map((p) => p.payload.type);
    expect(types).toEqual(['agent_session.updated', 'activity.created']);
    const [activity] = await h.db.select().from(schema.activityEvents);
    expect(activity).toMatchObject({
      source: 'agent',
      kind: 'agent_session_start',
      agentSessionId: s.id,
      taskId: task8,
      repoId: 99,
    });
  });

  it('confirms the link from an HK ref in the branch and follows the state machine', async () => {
    await handle(ev('SessionStart', 0, { branch: 'hk-7-auth' }));
    expect(await sessionRow()).toMatchObject({ taskId: task7, linkKind: 'confirmed' });
    await handle(ev('PostToolUse', 1, { branch: 'hk-7-auth', toolName: 'Edit' }));
    await handle(ev('PermissionRequest', 2, { branch: 'hk-7-auth' }));
    const s = await sessionRow();
    expect(s.status).toBe('awaiting_input');
    expect(s.summary).toEqual({ toolCounts: { Edit: 1 }, subagents: 0, awaitingSince: at(2) });
    await handle(ev('SessionEnd', 3, { branch: 'hk-7-auth' }));
    expect(await sessionRow()).toMatchObject({ status: 'ended', endedAt: new Date(at(3)) });
    const kinds = (await h.db.select().from(schema.activityEvents)).map((a) => a.kind).sort();
    expect(kinds).toEqual(['agent_awaiting_input', 'agent_session_end', 'agent_session_start']);
  });

  it('is idempotent for a redelivered transition and ignores stale status changes', async () => {
    await handle(ev('SessionStart', 0));
    await handle(ev('Stop', 5));
    await handle(ev('Stop', 5));
    await handle(ev('UserPromptSubmit', 4));
    expect((await sessionRow()).status).toBe('idle');
    expect(await h.db.select().from(schema.activityEvents)).toHaveLength(2);
  });

  it('drops events from a token revoked after they were queued', async () => {
    await h.db
      .update(schema.agentTokens)
      .set({ revokedAt: new Date() })
      .where(eq(schema.agentTokens.id, tokenId));
    await handle(ev('SessionStart', 0));
    expect(await h.db.select().from(schema.agentSessions)).toHaveLength(0);
  });

  it('times sessions out from the cron sweep and lets a newer event win', async () => {
    await handle(ev('SessionStart', 0));
    published.length = 0;
    expect(await sweepAgentSessions(h.db, publish, new Date(at(5)))).toBe(0);
    expect(await sweepAgentSessions(h.db, publish, new Date(at(11)))).toBe(1);
    expect((await sessionRow()).status).toBe('idle');
    expect(published.map((p) => p.payload.type)).toEqual(['agent_session.updated']);
    expect(await sweepAgentSessions(h.db, publish, new Date(at(121)))).toBe(1);
    expect(await sessionRow()).toMatchObject({ status: 'ended', endedAt: new Date(at(121)) });
  });
});

describe('agent session routes', () => {
  it('lists project sessions and pins a confirmed link against re-inference', async () => {
    await handle(ev('SessionStart', 0));
    const list = (await (
      await h.call(`/projects/${pid}/agent-sessions`, { token: owner.token })
    ).json()) as AgentSession[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ taskId: task8, linkKind: 'inferred' });
    expect(JSON.stringify(list[0]!.summary)).not.toContain('linkedBy');

    const res = await h.call(`/agent-sessions/${list[0]!.id}`, {
      method: 'PATCH',
      token: mate.token,
      json: { taskId: task7 },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ taskId: task7, linkKind: 'confirmed' });
    expect(h.broadcasts).toContainEqual(expect.objectContaining({ type: 'agent_session.updated' }));

    await handle(ev('UserPromptSubmit', 1, { branch: 'feature/x' }));
    expect(await sessionRow()).toMatchObject({ taskId: task7, linkKind: 'confirmed' });
  });

  it('lets only the session owner or a workspace owner relink, within the workspace', async () => {
    await handle(ev('SessionStart', 0));
    const { id } = await sessionRow();
    const third = await h.signIn(3, 'lee');
    await h.db
      .insert(schema.memberships)
      .values({ workspaceId: wid, userId: third.id, role: 'member', colorIndex: 2 });
    const patch = (who: { token: string }, taskId: string | null) =>
      h.call(`/agent-sessions/${id}`, { method: 'PATCH', token: who.token, json: { taskId } });
    expect((await patch(third, null)).status).toBe(403);
    expect((await patch(owner, null)).status).toBe(200);
    expect(await sessionRow()).toMatchObject({ taskId: null, linkKind: 'none' });
    expect((await patch(mate, '10000000-0000-4000-8000-000000000999')).status).toBe(404);
  });
});
