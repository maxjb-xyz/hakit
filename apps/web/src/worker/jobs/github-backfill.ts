/**
 * `github.backfill` (T-405): after a repo is connected, ingest the last `sinceHours` of commits, branches and
 * PRs so the Code screen and Mission Control are not empty until the next push. Idempotent: event IDs are
 * derived from the project and a natural key, commits dedupe by sha (shared webhook store), and branch / PR
 * rows dedupe against anything already recorded for the same branch or PR — including webhook rows.
 */
import { createDb, schema, type Db } from '@hakit/db';
import { ActivityEvent, JobMessage, WsPayload, type ActivityEvent as Activity } from '@hakit/contracts';
import { and, eq, isNull } from 'drizzle-orm';
import type { Env } from '../env';
import { isMock } from '../env';
import { broadcast } from '../lib/broadcast';
import { githubAppJwt } from '../lib/github-app-jwt';
import { resolveAuthor, type AuthorLookup, type NormalizedActivity } from '../services/github/normalize';
import { referencedTaskNumbers } from '../services/github/linking';
import {
  GithubBackfillError,
  githubBackfillClient,
  normalizeBackfill,
  type BackfillSnapshot,
} from '../services/github/backfill';
import { activityStore, eventId, type ActivityTransaction } from './github-webhook';

type BackfillJob = Extract<JobMessage, { type: 'github.backfill' }>;

export interface ConnectedRepo {
  id: number;
  fullName: string;
  defaultBranch: string;
  installationId: number;
}

export interface BackfillTransaction extends AuthorLookup {
  taskByNumber: ActivityTransaction['taskByNumber'];
  /** True when the project already has this commit (sha), branch or PR event, from a webhook or an earlier run. */
  hasEquivalent(event: Activity): Promise<boolean>;
  save: ActivityTransaction['save'];
}

export interface BackfillDependencies {
  /** The repo, only while it is still connected to the project through an unsuspended installation. */
  connectedRepo(projectId: string, repoId: number): Promise<ConnectedRepo | null>;
  snapshot(repo: ConnectedRepo, since: string): Promise<BackfillSnapshot>;
  transaction<T>(run: (tx: BackfillTransaction) => Promise<T>): Promise<T>;
  publish(event: Activity): Promise<void>;
  requestLink(event: Activity): Promise<void>;
  now(): number;
}

/** Natural key per normalized row; the same key always yields the same event ID. */
export function backfillKey(a: NormalizedActivity['activity']): string {
  if (a.kind === 'commit') return `commit:${a.sha}`;
  if (a.kind === 'branch_created') return `branch:${a.ref}`;
  return `${a.kind}:${a.prNumber}`;
}

/** A backfill that gives up is acked, so log why: otherwise a connected repo just shows no activity. */
function skipped(reason: string, job: BackfillJob) {
  console.warn(
    JSON.stringify({
      level: 'warn',
      msg: 'github backfill skipped',
      reason,
      projectId: job.projectId,
      repoId: job.repoId,
    }),
  );
}

/** Fetch outside the transaction, store transactionally, then notify and queue inferred linking. */
export async function processGithubBackfill(input: BackfillJob, deps: BackfillDependencies): Promise<number> {
  const job = JobMessage.parse(input) as BackfillJob;
  const repo = await deps.connectedRepo(job.projectId, job.repoId);
  if (!repo) {
    skipped('repo_not_connected', job);
    return 0;
  }
  const since = new Date(deps.now() - job.sinceHours * 3_600_000).toISOString();
  let snapshot: BackfillSnapshot;
  try {
    snapshot = await deps.snapshot(repo, since);
  } catch (err) {
    // A deleted repo or removed installation will never succeed; ack instead of filling the DLQ.
    if (err instanceof GithubBackfillError && !err.retryable) {
      skipped(err.message, job);
      return 0;
    }
    throw err;
  }
  const normalized = normalizeBackfill(snapshot, since);
  const saved = await deps.transaction(async (tx) => {
    const stored: Activity[] = [];
    for (const item of normalized) {
      const author = await resolveAuthor(item.actor, tx);
      const taskId = await tx.taskByNumber(
        job.projectId,
        referencedTaskNumbers(item.activity.ref, item.linkText),
      );
      const activity = ActivityEvent.parse({
        ...item.activity,
        ...author,
        ...(taskId ? { taskId, linkKind: 'confirmed', linkConfidence: null } : {}),
        projectId: job.projectId,
        id: await eventId(`backfill:${backfillKey(item.activity)}`, job.projectId, 0),
      });
      // Anything already recorded (by a webhook or an earlier run) is neither rewritten nor re-announced.
      if (await tx.hasEquivalent(activity)) continue;
      const row = await tx.save(activity);
      if (row) stored.push(row);
    }
    return stored;
  });
  for (const event of saved) {
    await deps.publish(event);
    if (event.linkKind === 'none') await deps.requestLink(event);
  }
  return saved.length;
}

export function databaseBackfillDependencies(
  db: Db,
  env: Env,
  client = githubBackfillClient(),
): BackfillDependencies {
  return {
    connectedRepo: async (projectId, repoId) => {
      const [row] = await db
        .select({
          id: schema.repos.id,
          fullName: schema.repos.fullName,
          defaultBranch: schema.repos.defaultBranch,
          installationId: schema.repos.installationId,
        })
        .from(schema.projectRepos)
        .innerJoin(schema.repos, eq(schema.repos.id, schema.projectRepos.repoId))
        .innerJoin(schema.githubInstallations, eq(schema.githubInstallations.id, schema.repos.installationId))
        .where(
          and(
            eq(schema.projectRepos.projectId, projectId),
            eq(schema.projectRepos.repoId, repoId),
            isNull(schema.githubInstallations.suspendedAt),
          ),
        )
        .limit(1);
      return row && row.installationId !== null ? { ...row, installationId: row.installationId } : null;
    },
    snapshot: async (repo, since) => {
      if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY)
        throw new GithubBackfillError('GitHub App credentials are not configured', false);
      const jwt = await githubAppJwt(
        env.GITHUB_APP_ID,
        env.GITHUB_APP_PRIVATE_KEY,
        Math.floor(Date.now() / 1000),
      );
      const token = await client.installationToken(jwt, repo.installationId);
      return client.snapshot(token, repo, since);
    },
    transaction: (run) =>
      db.transaction(async (tx) => {
        const store = activityStore(tx);
        return run({
          ...store,
          hasEquivalent: async (event) => {
            const [row] = await tx
              .select({ id: schema.activityEvents.id })
              .from(schema.activityEvents)
              .where(
                and(
                  eq(schema.activityEvents.projectId, event.projectId),
                  eq(schema.activityEvents.source, 'github'),
                  eq(schema.activityEvents.kind, event.kind),
                  event.kind === 'commit'
                    ? eq(schema.activityEvents.sha, event.sha ?? '')
                    : event.prNumber !== null
                      ? eq(schema.activityEvents.prNumber, event.prNumber)
                      : eq(schema.activityEvents.ref, event.ref ?? ''),
                ),
              )
              .limit(1);
            return !!row;
          },
        });
      }),
    publish: async (event) => {
      await broadcast(env, event.projectId, WsPayload.parse({ type: 'activity.created', data: { event } }));
    },
    requestLink: async (event) => {
      await env.JOBS.send(
        JobMessage.parse({ type: 'activity.link', eventId: event.id, projectId: event.projectId }),
      );
    },
    now: () => Date.now(),
  };
}

export async function githubBackfillJob(job: BackfillJob, { env }: { env: Env }): Promise<void> {
  // Mock mode has no GitHub App or database; fixture activity already stands in for the backfill.
  if (isMock(env)) return;
  const handle = createDb(env.HYPERDRIVE.connectionString);
  try {
    await handle.ready;
    const count = await processGithubBackfill(job, databaseBackfillDependencies(handle.db, env));
    console.log(JSON.stringify({ level: 'info', msg: 'github backfill done', events: count }));
  } finally {
    await handle.close();
  }
}
