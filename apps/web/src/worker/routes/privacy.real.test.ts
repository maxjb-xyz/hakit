/**
 * "Your data" in real mode on the in-memory D1: export contents (and no secrets), account deletion (personal
 * rows gone, team board intact, sole-owner 409, sole-member workspace removed) and workspace deletion.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { eq, inArray, sql, type SQL } from 'drizzle-orm';
import { AccountExport } from '@hakit/contracts';
import { planDocument } from '@hakit/contracts/fixtures';
import { schema, type Db } from '@hakit/db';
import { createHarness } from '../test/harness';

type Harness = Awaited<ReturnType<typeof createHarness>>;
let h: Harness;
let db: Db;

beforeEach(async () => {
  h = await createHarness();
  db = h.db;
}, 30_000);

const TOKEN_HASH = 'a'.repeat(64);
const ENC = new TextEncoder().encode('encrypted-github-token-bytes');
const b64 = (v: Uint8Array) => btoa(String.fromCharCode(...v));

async function newWorkspace(token: string, name: string) {
  const res = await h.call('/workspaces', {
    method: 'POST',
    token,
    json: { name, startsAt: '2000-01-01T00:00:00Z', deadlineAt: '2099-01-01T00:00:00Z' },
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { id: string }).id;
}

/** A team workspace (owner A, member B) with a project full of shared data, plus A's personal data. */
async function seedTeam() {
  const a = await h.signIn(1, 'alice');
  const b = await h.signIn(2, 'bob');
  const wid = await newWorkspace(a.token, 'Team Orbit');
  await db
    .insert(schema.memberships)
    .values({ workspaceId: wid, userId: b.id, role: 'member', colorIndex: 1 });
  await db.insert(schema.memberProfiles).values({ workspaceId: wid, userId: b.id });
  const [p] = await db.insert(schema.projects).values({ workspaceId: wid, name: 'Hakit' }).returning();
  const pid = p!.id;
  const [plan] = await db
    .insert(schema.plans)
    .values({
      projectId: pid,
      version: 1,
      payload: planDocument,
      feasibility: {},
      model: 't',
      createdBy: a.id,
    })
    .returning();
  const [ms] = await db
    .insert(schema.milestones)
    .values({ projectId: pid, planId: plan!.id, title: 'M1', ordinal: 1 })
    .returning();
  const [t1, t2] = await db
    .insert(schema.tasks)
    .values(
      [1, 2].map((number) => ({ projectId: pid, number, title: `Task ${number}`, milestoneId: ms!.id })),
    )
    .returning();
  await db.insert(schema.taskDependencies).values({ taskId: t2!.id, dependsOnTaskId: t1!.id });
  const assignment = (taskId: string, userId: string) => ({
    taskId,
    userId,
    status: 'active' as const,
    source: 'manual' as const,
    score: 0.5,
    breakdown: {},
    explanation: 'x',
    createdBy: a.id,
  });
  await db.insert(schema.assignments).values([assignment(t1!.id, a.id), assignment(t2!.id, b.id)]);
  await db.insert(schema.taskEvents).values([
    { taskId: t1!.id, actorUserId: a.id, kind: 'status', fromValue: 'todo', toValue: 'in_progress' },
    { taskId: t2!.id, actorUserId: b.id, kind: 'status', fromValue: 'todo', toValue: 'done' },
  ]);
  const [session] = await db
    .insert(schema.agentSessions)
    .values({
      externalSessionId: 'ext-1',
      userId: a.id,
      workspaceId: wid,
      projectId: pid,
      agent: 'claude_code',
    })
    .returning();
  const now = Date.now();
  await db.insert(schema.activityEvents).values([
    {
      ts: new Date(now),
      projectId: pid,
      source: 'github',
      kind: 'commit',
      title: 'a commit',
      actorUserId: a.id,
      actorRaw: 'alice',
    },
    {
      ts: new Date(now + 1),
      projectId: pid,
      source: 'agent',
      kind: 'agent_session',
      title: 'a agent',
      actorUserId: a.id,
      agentSessionId: session!.id,
    },
    {
      ts: new Date(now + 2),
      projectId: pid,
      source: 'github',
      kind: 'commit',
      title: 'b commit',
      actorUserId: b.id,
      actorRaw: 'bob',
    },
  ]);
  await db.insert(schema.recommendations).values([
    {
      projectId: pid,
      kind: 'check_in',
      severity: 'info',
      headline: 'ping alice',
      rationale: 'r',
      actions: [{ op: 'notify', userId: a.id, message: 'hi' }],
      dedupeKey: 'k1',
    },
    {
      projectId: pid,
      kind: 'check_in',
      severity: 'info',
      headline: 'ping bob',
      rationale: 'r',
      actions: [{ op: 'notify', userId: b.id, message: 'hi' }],
      dedupeKey: 'k2',
    },
    {
      projectId: pid,
      kind: 'check_in',
      severity: 'info',
      headline: 'done',
      rationale: 'r',
      actions: [],
      dedupeKey: 'k3',
      status: 'dismissed',
      resolvedBy: a.id,
    },
  ]);
  await db.insert(schema.invites).values([
    { workspaceId: wid, code: 'ALICECODE1', createdBy: a.id, expiresAt: new Date(now + 3_600_000) },
    { workspaceId: wid, code: 'BOBCODE001', createdBy: b.id, expiresAt: new Date(now + 3_600_000) },
  ]);
  await db.insert(schema.githubInstallations).values({
    id: 77,
    accountLogin: 'alice',
    accountType: 'User',
    repositorySelection: 'all',
    createdByUserId: a.id,
  });
  await db.insert(schema.repos).values({
    id: 99,
    installationId: 77,
    fullName: 'alice/hakit',
    htmlUrl: 'https://github.com/alice/hakit',
  });
  await db.insert(schema.projectRepos).values({ projectId: pid, repoId: 99, connectedBy: a.id });
  await db
    .insert(schema.agentTokens)
    .values({ userId: a.id, workspaceId: wid, name: 'laptop', tokenHash: TOKEN_HASH });
  await db.insert(schema.githubTokens).values({ userId: a.id, accessTokenEnc: ENC, refreshTokenEnc: ENC });
  const [skill] = await db
    .insert(schema.skills)
    .values({ slug: 'typescript', name: 'TypeScript', category: 'frontend' })
    .returning();
  await db
    .insert(schema.memberSkills)
    .values({ userId: a.id, skillId: skill!.id, level: 4, confidence: 0.9, source: 'confirmed' });
  await db.insert(schema.skillEvidence).values({
    userId: a.id,
    skillId: skill!.id,
    kind: 'repo_language',
    sourceRef: 'alice/hakit',
    weight: 1,
    summary: 'TS repo',
    observedAt: new Date(now),
  });
  await db
    .insert(schema.memberEmbeddings)
    .values({ userId: a.id, workspaceId: wid, kind: 'profile', embedding: [0.1], model: 'm' });
  await db
    .insert(schema.authorAliases)
    .values({ emailOrLogin: 'alice@example.com', userId: a.id, kind: 'email' });
  return { a, b, wid, pid, t1: t1!.id, t2: t2!.id, sessionId: session!.id };
}

type Table = Parameters<ReturnType<Db['select']>['from']>[0];
const count = async (table: Table, where?: SQL) =>
  (
    await db
      .select({ n: sql<number>`count(*)` })
      .from(table)
      .where(where)
  )[0]!.n;

describe('GET /me/export', () => {
  it('returns everything stored about the caller and no secrets', async () => {
    const s = await seedTeam();
    const res = await h.call('/me/export', { token: s.a.token });
    expect(res.status).toBe(200);
    const text = await res.text();
    const out = AccountExport.parse(JSON.parse(text));
    expect(out.user).toMatchObject({ id: s.a.id, githubLogin: 'alice' });
    expect(out.github.connected).toBe(true);
    expect(out.sessions).toHaveLength(1);
    expect(out.memberships).toEqual([
      expect.objectContaining({ workspaceId: s.wid, role: 'owner', workspaceName: 'Team Orbit' }),
    ]);
    expect(out.memberProfiles.map((p) => p.workspaceId)).toEqual([s.wid]);
    expect(out.skills).toEqual([expect.objectContaining({ slug: 'typescript', level: 4 })]);
    expect(out.skillEvidence).toEqual([
      expect.objectContaining({ skillSlug: 'typescript', sourceRef: 'alice/hakit' }),
    ]);
    expect(out.embeddings).toHaveLength(1);
    expect(out.authorAliases).toEqual([
      { emailOrLogin: 'alice@example.com', kind: 'email', confirmed: false },
    ]);
    expect(out.assignments).toEqual([expect.objectContaining({ taskId: s.t1, taskTitle: 'Task 1' })]);
    expect(out.taskEvents).toEqual([expect.objectContaining({ taskId: s.t1, toValue: 'in_progress' })]);
    expect(out.activityEvents.map((e) => e.title).sort()).toEqual(['a agent', 'a commit']);
    expect(out.agentSessions).toEqual([
      expect.objectContaining({ id: s.sessionId, externalSessionId: 'ext-1' }),
    ]);
    expect(out.agentTokens).toEqual([expect.objectContaining({ name: 'laptop', workspaceId: s.wid })]);

    // Secrets: token hash, encrypted GitHub token, the session id (hash) and the cookie token itself.
    const [sess] = await db.select().from(schema.sessions).where(eq(schema.sessions.userId, s.a.id));
    for (const secret of [TOKEN_HASH, b64(ENC), sess!.id, s.a.token])
      expect(text.includes(secret), `leaked ${secret.slice(0, 8)}`).toBe(false);
    expect(text).not.toMatch(/tokenHash|accessTokenEnc|refreshTokenEnc/);
    // Nobody else's data.
    expect(text).not.toContain('b commit');
  });

  it('requires a session', async () => {
    expect((await h.call('/me/export')).status).toBe(401);
  });
});

describe('DELETE /me', () => {
  it('refuses a sole owner whose workspace has other members, deleting nothing', async () => {
    const s = await seedTeam();
    const res = await h.call('/me', { method: 'DELETE', token: s.a.token });
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: { message: string; details: { workspaces: { id: string }[] } };
    };
    expect(body.error.message).toContain('Team Orbit');
    expect(body.error.details.workspaces.map((w) => w.id)).toEqual([s.wid]);
    expect(await count(schema.users, eq(schema.users.id, s.a.id))).toBe(1);
    expect((await h.call('/me/export', { token: s.a.token })).status).toBe(200);
  });

  it('removes personal data, keeps the team board, deletes their solo workspace', async () => {
    const s = await seedTeam();
    // Bob becomes a co-owner, so Alice may leave; she also has a workspace of her own.
    await db.update(schema.memberships).set({ role: 'owner' }).where(eq(schema.memberships.userId, s.b.id));
    const solo = await newWorkspace(s.a.token, 'Just Alice');
    const [soloProject] = await db
      .insert(schema.projects)
      .values({ workspaceId: solo, name: 'Solo' })
      .returning();
    await db.insert(schema.activityEvents).values({
      ts: new Date(),
      projectId: soloProject!.id,
      source: 'hakit',
      kind: 'task_status',
      title: 'solo event',
    });

    const res = await h.call('/me', { method: 'DELETE', token: s.a.token });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(res.headers.getSetCookie().some((c) => c.startsWith('hakit_session=;'))).toBe(true);
    expect((await h.call('/me', { token: s.a.token })).status).toBe(401);

    // Personal rows are gone.
    const uid = s.a.id;
    expect(await count(schema.users, eq(schema.users.id, uid))).toBe(0);
    for (const [table, col] of [
      [schema.sessions, schema.sessions.userId],
      [schema.githubTokens, schema.githubTokens.userId],
      [schema.memberships, schema.memberships.userId],
      [schema.memberProfiles, schema.memberProfiles.userId],
      [schema.memberSkills, schema.memberSkills.userId],
      [schema.skillEvidence, schema.skillEvidence.userId],
      [schema.memberEmbeddings, schema.memberEmbeddings.userId],
      [schema.authorAliases, schema.authorAliases.userId],
      [schema.agentTokens, schema.agentTokens.userId],
      [schema.agentSessions, schema.agentSessions.userId],
      [schema.assignments, schema.assignments.userId],
      [schema.activityEvents, schema.activityEvents.actorUserId],
      [schema.taskEvents, schema.taskEvents.actorUserId],
      [schema.invites, schema.invites.createdBy],
    ] as const)
      expect(await count(table, eq(col as never, uid)), table.toString()).toBe(0);

    // The team's board is intact, references nulled or handed over.
    const [w] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, s.wid));
    expect(w!.createdBy).toBe(s.b.id);
    expect(await count(schema.tasks, eq(schema.tasks.projectId, s.pid))).toBe(2);
    expect(await count(schema.taskDependencies)).toBe(1);
    const [bobAssignment] = await db.select().from(schema.assignments);
    expect(bobAssignment).toMatchObject({ taskId: s.t2, userId: s.b.id, createdBy: null });
    expect((await db.select().from(schema.taskEvents)).map((e) => e.actorUserId).sort()).toEqual(
      [s.b.id, null].sort(),
    );
    const activity = await db
      .select()
      .from(schema.activityEvents)
      .where(eq(schema.activityEvents.projectId, s.pid));
    expect(activity.map((e) => [e.title, e.actorUserId, e.actorRaw]).sort()).toEqual([
      ['a commit', null, null],
      ['b commit', s.b.id, 'bob'],
    ]);
    const [plan] = await db.select().from(schema.plans);
    expect(plan!.createdBy).toBeNull();
    const recs = await db.select().from(schema.recommendations);
    expect(recs.find((r) => r.dedupeKey === 'k1')!.status).toBe('expired');
    expect(recs.find((r) => r.dedupeKey === 'k2')!.status).toBe('open');
    expect(recs.find((r) => r.dedupeKey === 'k3')!.resolvedBy).toBeNull();
    expect((await db.select().from(schema.invites)).map((i) => i.code)).toEqual(['BOBCODE001']);
    expect((await db.select().from(schema.projectRepos))[0]!.connectedBy).toBeNull();
    expect((await db.select().from(schema.githubInstallations))[0]!.createdByUserId).toBeNull();
    expect(await count(schema.memberships, eq(schema.memberships.workspaceId, s.wid))).toBe(1);

    // The workspace only she was in went with her.
    expect(await count(schema.workspaces, eq(schema.workspaces.id, solo))).toBe(0);
    expect(await count(schema.projects, eq(schema.projects.id, soloProject!.id))).toBe(0);
    expect(await count(schema.activityEvents, eq(schema.activityEvents.projectId, soloProject!.id))).toBe(0);
    expect(h.closedRooms).toEqual(expect.arrayContaining([`workspace:${solo}`, soloProject!.id]));
    expect(h.closedRooms).not.toContain(s.pid);

    // Bob still sees his workspace and board.
    expect((await h.call(`/projects/${s.pid}/board`, { token: s.b.token })).status).toBe(200);
    expect((await h.call(`/w/${s.wid}/members`, { token: s.b.token })).status).toBe(200);
  });

  it('a plain member can delete their account', async () => {
    const s = await seedTeam();
    const res = await h.call('/me', { method: 'DELETE', token: s.b.token });
    expect(res.status).toBe(200);
    expect(await count(schema.workspaces, eq(schema.workspaces.id, s.wid))).toBe(1);
    expect(await count(schema.memberships, eq(schema.memberships.workspaceId, s.wid))).toBe(1);
    expect(await count(schema.tasks)).toBe(2);
  });

  it('requires the CSRF header', async () => {
    const a = await h.signIn(5);
    expect((await h.call('/me', { method: 'DELETE', token: a.token, csrf: false })).status).toBe(403);
    expect(await count(schema.users, eq(schema.users.id, a.id))).toBe(1);
  });
});

describe('DELETE /w/:wid', () => {
  it('is owner only and needs the exact workspace name', async () => {
    const s = await seedTeam();
    const del = (token: string, confirmName: string) =>
      h.call(`/w/${s.wid}`, { method: 'DELETE', token, json: { confirmName } });
    expect((await del(s.b.token, 'Team Orbit')).status).toBe(403);
    const wrong = await del(s.a.token, 'team orbit');
    expect(wrong.status).toBe(400);
    expect(((await wrong.json()) as { error: { code: string } }).error.code).toBe('confirm_mismatch');
    expect((await h.call(`/w/${s.wid}`, { method: 'DELETE', token: s.a.token, json: {} })).status).toBe(400);
    expect(await count(schema.workspaces, eq(schema.workspaces.id, s.wid))).toBe(1);
  });

  it('deletes everything scoped to the workspace and nothing else', async () => {
    const s = await seedTeam();
    // Another workspace with its own project, task and activity must survive.
    const other = await newWorkspace(s.b.token, 'Elsewhere');
    const [op] = await db.insert(schema.projects).values({ workspaceId: other, name: 'Other' }).returning();
    await db.insert(schema.tasks).values({ projectId: op!.id, number: 1, title: 'keep me' });
    await db
      .insert(schema.activityEvents)
      .values({ ts: new Date(), projectId: op!.id, source: 'github', kind: 'commit', title: 'keep' });

    const res = await h.call(`/w/${s.wid}`, {
      method: 'DELETE',
      token: s.a.token,
      json: { confirmName: 'Team Orbit' },
    });
    expect(res.status, await res.clone().text()).toBe(200);

    expect(await count(schema.workspaces, eq(schema.workspaces.id, s.wid))).toBe(0);
    expect(await count(schema.projects, eq(schema.projects.workspaceId, s.wid))).toBe(0);
    expect(await count(schema.memberships, eq(schema.memberships.workspaceId, s.wid))).toBe(0);
    expect(await count(schema.memberProfiles, eq(schema.memberProfiles.workspaceId, s.wid))).toBe(0);
    expect(await count(schema.invites, eq(schema.invites.workspaceId, s.wid))).toBe(0);
    expect(await count(schema.agentTokens, eq(schema.agentTokens.workspaceId, s.wid))).toBe(0);
    expect(await count(schema.agentSessions, eq(schema.agentSessions.workspaceId, s.wid))).toBe(0);
    expect(await count(schema.memberEmbeddings, eq(schema.memberEmbeddings.workspaceId, s.wid))).toBe(0);
    for (const table of [
      schema.plans,
      schema.milestones,
      schema.taskDependencies,
      schema.assignments,
      schema.taskEvents,
      schema.recommendations,
      schema.projectRepos,
    ])
      expect(await count(table), table.toString()).toBe(0);
    expect(await count(schema.tasks, eq(schema.tasks.projectId, s.pid))).toBe(0);
    expect(await count(schema.activityEvents, eq(schema.activityEvents.projectId, s.pid))).toBe(0);

    // Untouched: the other workspace, the users and their personal data, instance-level GitHub rows.
    expect(await count(schema.workspaces, eq(schema.workspaces.id, other))).toBe(1);
    expect(await count(schema.tasks, eq(schema.tasks.projectId, op!.id))).toBe(1);
    expect(await count(schema.activityEvents, eq(schema.activityEvents.projectId, op!.id))).toBe(1);
    expect(await count(schema.users, inArray(schema.users.id, [s.a.id, s.b.id]))).toBe(2);
    expect(await count(schema.memberSkills)).toBe(1);
    expect(await count(schema.repos)).toBe(1);

    // Rooms are closed; the workspace is gone for its former members.
    expect(h.closedRooms).toEqual(expect.arrayContaining([`workspace:${s.wid}`, s.pid]));
    expect(h.broadcasts).toEqual([]);
    expect((await h.call(`/w/${s.wid}`, { token: s.b.token })).status).toBe(404);
    expect((await h.call(`/projects/${s.pid}/board`, { token: s.a.token })).status).toBe(404);
  });
});
