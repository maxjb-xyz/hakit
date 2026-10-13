import { commit, schema, type Db } from '@hakit/db';
import { Id, JobMessage, type RepoSummary } from '@hakit/contracts';
import { and, eq } from 'drizzle-orm';
import { notFound } from '../../lib/errors';
import type { Env } from '../../env';
import type { Installation } from './discovery';

/** How far back a newly connected repo's history is imported. */
export const BACKFILL_HOURS = 30 * 24;

export async function requireWorkspaceMember(db: Pick<Db, 'select'>, userId: string, workspaceId: string) {
  if (!Id.safeParse(workspaceId).success) throw notFound('Workspace');
  const [row] = await db
    .select()
    .from(schema.memberships)
    .where(and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.userId, userId)))
    .limit(1);
  if (!row) throw notFound('Workspace');
}

export async function requireProjectMember(db: Pick<Db, 'select'>, userId: string, projectId: string) {
  if (!Id.safeParse(projectId).success) throw notFound('Project');
  const [row] = await db
    .select({ workspaceId: schema.projects.workspaceId })
    .from(schema.projects)
    .innerJoin(
      schema.memberships,
      and(
        eq(schema.projects.workspaceId, schema.memberships.workspaceId),
        eq(schema.memberships.userId, userId),
      ),
    )
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  if (!row) throw notFound('Project');
  return row;
}

/** The installation upsert; await it, or pass it to `commit` with dependent writes. */
export function saveInstallation(db: Pick<Db, 'insert'>, installation: Installation) {
  const values = {
    id: installation.id,
    accountLogin: installation.account.login,
    accountType: installation.account.type,
    repositorySelection: installation.repository_selection,
    suspendedAt: installation.suspended_at ? new Date(installation.suspended_at) : null,
    updatedAt: new Date(),
  };
  return db
    .insert(schema.githubInstallations)
    .values(values)
    .onConflictDoUpdate({ target: schema.githubInstallations.id, set: values });
}

export async function connectRepository(
  db: Db,
  env: Env,
  projectId: string,
  userId: string,
  repo: RepoSummary,
  installation: Installation,
) {
  const values = {
    id: repo.id,
    installationId: repo.installationId,
    fullName: repo.fullName,
    private: repo.private,
    defaultBranch: repo.defaultBranch,
    htmlUrl: repo.htmlUrl,
    pushedAt: repo.pushedAt ? new Date(repo.pushedAt) : null,
    updatedAt: new Date(),
  };
  // Repeat the membership check right before the writes; a removal landing in between is accepted (it is
  // equivalent to the removal arriving just after the connection).
  await requireProjectMember(db, userId, projectId);
  await commit(db, [
    saveInstallation(db, installation),
    db.insert(schema.repos).values(values).onConflictDoUpdate({ target: schema.repos.id, set: values }),
    db
      .insert(schema.projectRepos)
      .values({ projectId, repoId: repo.id, connectedBy: userId })
      .onConflictDoNothing(),
    db.update(schema.projects).set({ repoId: repo.id }).where(eq(schema.projects.id, projectId)),
  ]);
  // A failed send returns an error; repeating the connection is safe and retries the backfill.
  // 30 days so a repo started before the event still shows its recent work; the client caps pages read.
  await env.JOBS.send(
    JobMessage.parse({ type: 'github.backfill', projectId, repoId: repo.id, sinceHours: BACKFILL_HOURS }),
  );
}
