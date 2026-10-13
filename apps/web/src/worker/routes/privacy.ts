/**
 * "Your data" on a self-hosted instance: export my data, delete my account, delete a workspace. Owner: PL.
 *
 * Deletion policy (FKs in packages/db/src/schema.ts; D1 enforces them):
 * - Personal rows go with the user (FK cascade on users): sessions, github_tokens, memberships, member_profiles,
 *   member_skills, skill_evidence, member_embeddings, author_aliases, agent_tokens, agent_sessions, and the
 *   user's own assignments (their tasks stay on the board, unassigned).
 * - Team data they authored stays and loses the reference (those FKs are NO ACTION, so they are cleared here
 *   first): task_events.actor_user_id, plans.created_by, assignments.created_by, recommendations.resolved_by,
 *   project_repos.connected_by, github_installations.created_by_user_id → null; workspaces.created_by → another
 *   member (owners first). Their pending invites are deleted. GitHub/Hakit activity rows are anonymized
 *   (actor_user_id and actor_raw null); their Claude Code telemetry rows (source 'agent') are deleted.
 * - Workspaces where they are the only member are deleted with them. A sole owner with teammates gets 409.
 * - Deleting a workspace cascades from `workspaces` to everything scoped to it; activity_events has no FK to
 *   projects, so it is deleted explicitly first. GitHub repos/installations are instance-level and stay.
 */
import { Hono, type Context } from 'hono';
import { and, eq, inArray, like, ne, notExists, or, sql } from 'drizzle-orm';
import type { AccountExport } from '@hakit/contracts';
import * as fx from '@hakit/contracts/fixtures';
import { chunkIds, commit, isGuardFailure, requireChanged, schema, type BatchItem, type Db } from '@hakit/db';
import type { AppEnv } from '../lib/context';
import { route } from '../lib/route';
import { conflict, HttpError, notFound } from '../lib/errors';
import { clearSessionCookie } from '../lib/session';
import { closeRooms } from '../lib/broadcast';
import { assertOwner } from '../middleware/auth';
import { toProfile } from './identity';

export const privacy = new Hono<AppEnv>();

const {
  users,
  githubTokens,
  sessions,
  workspaces,
  memberships,
  memberProfiles,
  memberSkills,
  skillEvidence,
  memberEmbeddings,
  skills,
  authorAliases,
  assignments,
  tasks,
  taskEvents,
  activityEvents,
  agentSessions,
  agentTokens,
  invites,
  plans,
  projects,
  recommendations,
  projectRepos,
  githubInstallations,
} = schema;

const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);
const ok = { ok: true as const };

/* --------------------------------- export --------------------------------- */

route(privacy, 'exportMe', async ({ c }) => {
  if (c.var.mocks) return mockExport();
  const db = c.var.db();
  const uid = c.var.user!.id;
  const [u] = await db.select().from(users).where(eq(users.id, uid)).limit(1);
  if (!u) throw notFound('User');

  const [
    token,
    sessionRows,
    membershipRows,
    profileRows,
    skillRows,
    evidenceRows,
    embeddingRows,
    aliasRows,
    assignmentRows,
    taskEventRows,
    activityRows,
    agentSessionRows,
    agentTokenRows,
  ] = await Promise.all([
    db
      .select({
        accessExpiresAt: githubTokens.accessExpiresAt,
        refreshExpiresAt: githubTokens.refreshExpiresAt,
        updatedAt: githubTokens.updatedAt,
      })
      .from(githubTokens)
      .where(eq(githubTokens.userId, uid))
      .limit(1),
    db
      .select({ createdAt: sessions.createdAt, expiresAt: sessions.expiresAt, userAgent: sessions.userAgent })
      .from(sessions)
      .where(eq(sessions.userId, uid)),
    db
      .select({ m: memberships, workspaceName: workspaces.name })
      .from(memberships)
      .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
      .where(eq(memberships.userId, uid)),
    db.select().from(memberProfiles).where(eq(memberProfiles.userId, uid)),
    db
      .select({ s: memberSkills, slug: skills.slug, name: skills.name })
      .from(memberSkills)
      .innerJoin(skills, eq(skills.id, memberSkills.skillId))
      .where(eq(memberSkills.userId, uid)),
    db
      .select({ e: skillEvidence, slug: skills.slug })
      .from(skillEvidence)
      .innerJoin(skills, eq(skills.id, skillEvidence.skillId))
      .where(eq(skillEvidence.userId, uid)),
    db
      .select({
        workspaceId: memberEmbeddings.workspaceId,
        kind: memberEmbeddings.kind,
        model: memberEmbeddings.model,
        updatedAt: memberEmbeddings.updatedAt,
      })
      .from(memberEmbeddings)
      .where(eq(memberEmbeddings.userId, uid)),
    db.select().from(authorAliases).where(eq(authorAliases.userId, uid)),
    db
      .select({ a: assignments, taskTitle: tasks.title })
      .from(assignments)
      .innerJoin(tasks, eq(tasks.id, assignments.taskId))
      .where(eq(assignments.userId, uid)),
    db.select().from(taskEvents).where(eq(taskEvents.actorUserId, uid)),
    db.select().from(activityEvents).where(eq(activityEvents.actorUserId, uid)),
    db.select().from(agentSessions).where(eq(agentSessions.userId, uid)),
    db
      .select({
        id: agentTokens.id,
        workspaceId: agentTokens.workspaceId,
        name: agentTokens.name,
        sharePrompts: agentTokens.sharePrompts,
        sharePaths: agentTokens.sharePaths,
        lastUsedAt: agentTokens.lastUsedAt,
        revokedAt: agentTokens.revokedAt,
        createdAt: agentTokens.createdAt,
      })
      .from(agentTokens)
      .where(eq(agentTokens.userId, uid)),
  ]);

  const t = token[0];
  const out: AccountExport = {
    format: 'hakit.account-export.v1',
    exportedAt: iso(new Date()),
    user: {
      id: u.id,
      githubUserId: u.githubUserId,
      githubLogin: u.githubLogin,
      name: u.name,
      avatarUrl: u.avatarUrl,
      email: u.email,
      createdAt: iso(u.createdAt),
      lastSeenAt: isoOrNull(u.lastSeenAt),
    },
    github: {
      connected: Boolean(t),
      accessExpiresAt: isoOrNull(t?.accessExpiresAt ?? null),
      refreshExpiresAt: isoOrNull(t?.refreshExpiresAt ?? null),
      updatedAt: isoOrNull(t?.updatedAt ?? null),
    },
    sessions: sessionRows.map((s) => ({
      createdAt: iso(s.createdAt),
      expiresAt: iso(s.expiresAt),
      userAgent: s.userAgent,
    })),
    memberships: membershipRows.map(({ m, workspaceName }) => ({
      workspaceId: m.workspaceId,
      workspaceName,
      role: m.role,
      colorIndex: m.colorIndex,
      joinedAt: iso(m.joinedAt),
    })),
    memberProfiles: profileRows.map(toProfile),
    skills: skillRows.map(({ s, slug, name }) => ({
      slug,
      name,
      level: s.level,
      confidence: s.confidence,
      source: s.source,
      confirmedAt: isoOrNull(s.confirmedAt),
      updatedAt: iso(s.updatedAt),
    })),
    skillEvidence: evidenceRows.map(({ e, slug }) => ({
      id: e.id,
      skillSlug: slug,
      kind: e.kind,
      sourceRef: e.sourceRef,
      url: e.url,
      weight: e.weight,
      summary: e.summary,
      detail: e.detail ?? null,
      observedAt: iso(e.observedAt),
    })),
    embeddings: embeddingRows.map((e) => ({ ...e, updatedAt: iso(e.updatedAt) })),
    authorAliases: aliasRows.map((a) => ({
      emailOrLogin: a.emailOrLogin,
      kind: a.kind,
      confirmed: a.confirmed,
    })),
    assignments: assignmentRows.map(({ a, taskTitle }) => ({
      id: a.id,
      taskId: a.taskId,
      taskTitle,
      status: a.status,
      source: a.source,
      locked: a.locked,
      score: a.score,
      reasonCodes: a.reasonCodes,
      explanation: a.explanation,
      createdAt: iso(a.createdAt),
    })),
    taskEvents: taskEventRows.map((e) => ({
      id: e.id,
      taskId: e.taskId,
      kind: e.kind,
      fromValue: e.fromValue,
      toValue: e.toValue,
      at: iso(e.at),
    })),
    activityEvents: activityRows.map((e) => ({
      id: e.id,
      ts: iso(e.ts),
      projectId: e.projectId,
      source: e.source,
      kind: e.kind,
      title: e.title,
      url: e.url,
      repoId: e.repoId,
      ref: e.ref,
      sha: e.sha,
      prNumber: e.prNumber,
      taskId: e.taskId,
      additions: e.additions,
      deletions: e.deletions,
      agentSessionId: e.agentSessionId,
      payload: e.payload ?? null,
    })),
    agentSessions: agentSessionRows.map((s) => ({
      id: s.id,
      externalSessionId: s.externalSessionId,
      workspaceId: s.workspaceId,
      projectId: s.projectId,
      agent: s.agent,
      repoFullName: s.repoFullName,
      branch: s.branch,
      status: s.status,
      taskId: s.taskId,
      startedAt: iso(s.startedAt),
      lastEventAt: iso(s.lastEventAt),
      endedAt: isoOrNull(s.endedAt),
      summary: s.summary ?? {},
    })),
    agentTokens: agentTokenRows.map((k) => ({
      ...k,
      lastUsedAt: isoOrNull(k.lastUsedAt),
      revokedAt: isoOrNull(k.revokedAt),
      createdAt: iso(k.createdAt),
    })),
  };
  return out;
});

function mockExport(): AccountExport {
  const me = fx.members[0]!;
  return {
    format: 'hakit.account-export.v1',
    exportedAt: iso(new Date()),
    user: { ...me.user, email: null, createdAt: fx.workspace.createdAt, lastSeenAt: null },
    github: { connected: true, accessExpiresAt: null, refreshExpiresAt: null, updatedAt: null },
    sessions: [],
    memberships: [
      {
        workspaceId: fx.workspace.id,
        workspaceName: fx.workspace.name,
        role: me.role,
        colorIndex: me.colorIndex,
        joinedAt: fx.workspace.createdAt,
      },
    ],
    memberProfiles: [me.profile],
    skills: (fx.memberSkillsByUser[me.user.id] ?? []).map((s) => ({
      slug: s.skill.slug,
      name: s.skill.name,
      level: s.level,
      confidence: s.confidence,
      source: s.source,
      confirmedAt: s.confirmedAt,
      updatedAt: fx.workspace.createdAt,
    })),
    skillEvidence: [],
    embeddings: [],
    authorAliases: [],
    assignments: [],
    taskEvents: [],
    activityEvents: [],
    agentSessions: [],
    agentTokens: [],
  };
}

/* ----------------------------- delete a workspace ----------------------------- */

/**
 * Batch items that delete a workspace and everything scoped to it. The FK cascade from `workspaces` covers
 * memberships, invites, profiles, embeddings, agent tokens/sessions and projects (→ constraints, ideas, plans,
 * milestones, tasks → dependencies, assignments, task events; recommendations; repo connections).
 * activity_events has no FK, so it goes first. Every statement binds one or two parameters.
 * `soleMember` turns the delete into a guarded one: it applies only while nobody else is a member, and the
 * batch rolls back (isGuardFailure) otherwise.
 */
export function workspaceDeletion(db: Db, workspaceId: string, soleMember?: string): BatchItem[] {
  const projectIds = db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.workspaceId, workspaceId));
  const others = db
    .select({ x: sql`1` })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), ne(memberships.userId, soleMember ?? '')));
  return [
    db.delete(activityEvents).where(inArray(activityEvents.projectId, projectIds)),
    db
      .delete(workspaces)
      .where(
        soleMember ? and(eq(workspaces.id, workspaceId), notExists(others)) : eq(workspaces.id, workspaceId),
      ),
    requireChanged(db, 1),
  ];
}

const projectIdsOf = async (db: Db, workspaceId: string) =>
  (await db.select({ id: projects.id }).from(projects).where(eq(projects.workspaceId, workspaceId))).map(
    (p) => p.id,
  );

/** Close the deleted workspace's rooms after the commit, without failing the request. */
const afterDeletion = (c: Context<AppEnv>, deleted: { workspaceId: string; projectIds: string[] }[]) =>
  c.executionCtx.waitUntil(
    Promise.all(deleted.map((d) => closeRooms(c.env, d.workspaceId, d.projectIds))).catch(() => {}),
  );

route(privacy, 'deleteWorkspace', async ({ c, params, body }) => {
  const mismatch = () =>
    new HttpError(400, 'confirm_mismatch', 'Type the workspace name exactly as shown to delete it');
  if (c.var.mocks) {
    if (body.confirmName.trim() !== fx.workspace.name) throw mismatch();
    return ok;
  }
  assertOwner(c);
  const db = c.var.db();
  const [w] = await db.select().from(workspaces).where(eq(workspaces.id, params.wid)).limit(1);
  if (!w) throw notFound('Workspace');
  if (body.confirmName.trim() !== w.name.trim()) throw mismatch();
  const projectIds = await projectIdsOf(db, w.id);
  try {
    await commit(db, workspaceDeletion(db, w.id));
  } catch (e) {
    // Deleted by a concurrent request.
    if (isGuardFailure(e)) throw notFound('Workspace');
    throw e;
  }
  afterDeletion(c, [{ workspaceId: w.id, projectIds }]);
  return ok;
});

/* ----------------------------- delete my account ----------------------------- */

route(privacy, 'deleteMe', async ({ c }) => {
  if (c.var.mocks) return ok;
  const db = c.var.db();
  const uid = c.var.user!.id;

  const mine = await db
    .select({ workspaceId: memberships.workspaceId, role: memberships.role, name: workspaces.name })
    .from(memberships)
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .where(eq(memberships.userId, uid));
  // Workspaces they created but may no longer belong to: workspaces.created_by is NOT NULL and NO ACTION.
  const created = await db
    .select({ workspaceId: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.createdBy, uid));
  const wids = [...new Set([...mine, ...created].map((w) => w.workspaceId))];
  const others = (
    await Promise.all(
      chunkIds(wids).map((chunk) =>
        db
          .select({
            workspaceId: memberships.workspaceId,
            userId: memberships.userId,
            role: memberships.role,
            joinedAt: memberships.joinedAt,
          })
          .from(memberships)
          .where(and(inArray(memberships.workspaceId, chunk), ne(memberships.userId, uid))),
      ),
    )
  ).flat();
  const othersIn = (wid: string) =>
    others
      .filter((o) => o.workspaceId === wid)
      .sort(
        (a, b) =>
          Number(b.role === 'owner') - Number(a.role === 'owner') ||
          a.joinedAt.getTime() - b.joinedAt.getTime(),
      );

  const blocking = mine.filter(
    (m) =>
      m.role === 'owner' &&
      othersIn(m.workspaceId).length > 0 &&
      othersIn(m.workspaceId)[0]!.role !== 'owner',
  );
  if (blocking.length)
    throw conflict(
      `You're the only owner of ${blocking.map((b) => `"${b.name}"`).join(', ')}, which still has other members. ` +
        'Transfer ownership to a teammate or delete the workspace first.',
      { workspaces: blocking.map((b) => ({ id: b.workspaceId, name: b.name })) },
    );

  const doomed = wids.filter((wid) => othersIn(wid).length === 0);
  const reassigned = created
    .map((w) => w.workspaceId)
    .filter((wid) => !doomed.includes(wid))
    .map((wid) => ({ wid, to: othersIn(wid)[0]!.userId }));
  const deleted = await Promise.all(
    doomed.map(async (workspaceId) => ({ workspaceId, projectIds: await projectIdsOf(db, workspaceId) })),
  );
  const mySessions = db
    .select({ id: agentSessions.id })
    .from(agentSessions)
    .where(eq(agentSessions.userId, uid));

  const items: BatchItem[] = [
    ...doomed.flatMap((wid) => workspaceDeletion(db, wid, uid)),
    ...reassigned.map(({ wid, to }) =>
      db
        .update(workspaces)
        .set({ createdBy: to })
        .where(and(eq(workspaces.id, wid), eq(workspaces.createdBy, uid))),
    ),
    // Clear every NO ACTION reference to the user so the final delete can't fail, keeping the team's rows.
    db.delete(invites).where(eq(invites.createdBy, uid)),
    db.update(plans).set({ createdBy: null }).where(eq(plans.createdBy, uid)),
    db.update(assignments).set({ createdBy: null }).where(eq(assignments.createdBy, uid)),
    // Open recommendations that would act on them (reassign to / notify them) can no longer be applied.
    db
      .update(recommendations)
      .set({ status: 'expired', resolvedAt: new Date() })
      .where(
        and(
          eq(recommendations.status, 'open'),
          or(
            like(sql`${recommendations.actions}`, `%${uid}%`),
            like(sql`${recommendations.signals}`, `%${uid}%`),
          ),
        ),
      ),
    db.update(recommendations).set({ resolvedBy: null }).where(eq(recommendations.resolvedBy, uid)),
    db.update(taskEvents).set({ actorUserId: null }).where(eq(taskEvents.actorUserId, uid)),
    db
      .update(githubInstallations)
      .set({ createdByUserId: null })
      .where(eq(githubInstallations.createdByUserId, uid)),
    db.update(projectRepos).set({ connectedBy: null }).where(eq(projectRepos.connectedBy, uid)),
    // Their Claude Code telemetry is personal; their GitHub/Hakit activity stays on the timeline, anonymized.
    db
      .delete(activityEvents)
      .where(and(eq(activityEvents.actorUserId, uid), eq(activityEvents.source, 'agent'))),
    db
      .update(activityEvents)
      .set({ agentSessionId: null })
      .where(inArray(activityEvents.agentSessionId, mySessions)),
    db
      .update(activityEvents)
      .set({ actorUserId: null, actorRaw: null })
      .where(eq(activityEvents.actorUserId, uid)),
    // Cascades: sessions, GitHub tokens, memberships, profiles, skills, evidence, embeddings, aliases,
    // agent tokens and sessions, and their own assignments.
    db.delete(users).where(eq(users.id, uid)),
    requireChanged(db, 1),
  ];
  try {
    await commit(db, items);
  } catch (e) {
    if (isGuardFailure(e))
      throw conflict(
        'Your workspaces changed while deleting (someone joined). Nothing was deleted; try again.',
      );
    throw e;
  }
  clearSessionCookie(c);
  afterDeletion(c, deleted);
  return ok;
});
