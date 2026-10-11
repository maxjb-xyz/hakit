import { schema, type Db } from '@hakit/db';
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

export async function saveInstallation(db: Pick<Db, 'insert'>, installation: Installation) {
  const values = {
    id: installation.id,
    accountLogin: installation.account.login,
    accountType: installation.account.type,
    repositorySelection: installation.repository_selection,
    suspendedAt: installation.suspended_at ? new Date(installation.suspended_at) : null,
    updatedAt: new Date(),
  };
  await db
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
  await db.transaction(async (tx) => {
    // Repeat membership check inside the mutation transaction.
    await requireProjectMember(tx, userId, projectId);
    await saveInstallation(tx, installation);
    await tx.insert(schema.repos).values(values).onConflictDoUpdate({ target: schema.repos.id, set: values });
    await tx
      .insert(schema.projectRepos)
      .values({ projectId, repoId: repo.id, connectedBy: userId })
      .onConflictDoNothing();
    await tx.update(schema.projects).set({ repoId: repo.id }).where(eq(schema.projects.id, projectId));
  });
  // A failed send returns an error; repeating the connection is safe and retries the backfill.
  // 30 days so a repo started before the event still shows its recent work; the client caps pages read.
  await env.JOBS.send(
    JobMessage.parse({ type: 'github.backfill', projectId, repoId: repo.id, sinceHours: BACKFILL_HOURS }),
  );
}
