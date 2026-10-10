import { z } from 'zod';
import { GithubId } from '@hakit/contracts';
import { schema, type Db } from '@hakit/db';
import { and, eq, lte, sql } from 'drizzle-orm';
import { Installation, GithubRepo } from './discovery';

const shortRepo = GithubRepo.omit({ html_url: true }).extend({ html_url: z.url().optional() });
const installationEvent = z.object({
  action: z.string(),
  installation: Installation,
  repositories: z.array(shortRepo).optional(),
  repository_selection: z.enum(['all', 'selected']).optional(),
  repositories_added: z.array(shortRepo).optional(),
  repositories_removed: z.array(z.object({ id: GithubId })).optional(),
});
const repositoryEvent = z.object({
  action: z.string(),
  installation: z.object({ id: GithubId }),
  repository: GithubRepo,
});

/** Runs inside the delivery transaction. Tombstones retain ordering information after revocation. */
export async function synchronizeGithub(
  db: Pick<Db, 'select' | 'insert' | 'update' | 'execute'>,
  event: string,
  payload: unknown,
  receivedAt: string,
) {
  const at = new Date(receivedAt);
  const p = event === 'repository' ? repositoryEvent.parse(payload) : installationEvent.parse(payload);
  const installationId = p.installation.id;
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`github-installation:${installationId}`}, 0))`,
  );
  const [current] = await db
    .select()
    .from(schema.githubInstallations)
    .where(eq(schema.githubInstallations.id, installationId));
  if (current && current.updatedAt > at) return;

  const detach = async (repoId?: number) => {
    const conditions = [eq(schema.repos.installationId, installationId), lte(schema.repos.updatedAt, at)];
    if (repoId !== undefined) conditions.push(eq(schema.repos.id, repoId));
    await db
      .update(schema.repos)
      .set({ installationId: null, updatedAt: at })
      .where(and(...conditions));
  };
  const upsertRepo = async (repo: z.infer<typeof shortRepo>) => {
    const values = {
      id: repo.id,
      installationId,
      fullName: repo.full_name,
      private: repo.private,
      htmlUrl: repo.html_url ?? `https://github.com/${repo.full_name}`,
      defaultBranch: repo.default_branch ?? 'main',
      archived: repo.archived ?? false,
      pushedAt: repo.pushed_at ? new Date(repo.pushed_at) : null,
      updatedAt: at,
    };
    const changes = {
      installationId,
      fullName: values.fullName,
      private: values.private,
      htmlUrl: values.htmlUrl,
      updatedAt: at,
      ...(repo.default_branch ? { defaultBranch: repo.default_branch } : {}),
      ...(repo.archived !== undefined ? { archived: repo.archived } : {}),
      ...(repo.pushed_at !== undefined ? { pushedAt: values.pushedAt } : {}),
    };
    await db
      .insert(schema.repos)
      .values(values)
      .onConflictDoUpdate({
        target: schema.repos.id,
        set: changes,
        setWhere: lte(schema.repos.updatedAt, at),
      });
  };
  if (event === 'repository') {
    const r = repositoryEvent.parse(payload);
    if (!current) throw new Error('GitHub installation metadata not yet synchronized');
    if (r.action === 'deleted') {
      await detach(r.repository.id);
      return;
    }
    if (current.suspendedAt === null) await upsertRepo(r.repository);
    return;
  }
  const i = installationEvent.parse(payload);
  const values = {
    id: installationId,
    accountLogin: i.installation.account.login,
    accountType: i.installation.account.type,
    repositorySelection: i.repository_selection ?? i.installation.repository_selection,
    suspendedAt:
      i.action === 'deleted' || i.action === 'suspend'
        ? at
        : i.installation.suspended_at
          ? new Date(i.installation.suspended_at)
          : null,
    updatedAt: at,
  };
  await db
    .insert(schema.githubInstallations)
    .values(values)
    .onConflictDoUpdate({ target: schema.githubInstallations.id, set: values });
  if (i.action === 'deleted') {
    await detach();
    return;
  }
  for (const repo of i.repositories_removed ?? []) await detach(repo.id);
  if (values.suspendedAt === null) {
    for (const repo of [...(i.repositories ?? []), ...(i.repositories_added ?? [])]) await upsertRepo(repo);
  }
}
