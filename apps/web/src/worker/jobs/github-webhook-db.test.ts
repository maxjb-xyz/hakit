import { describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema, type Db } from '@hakit/db';
import { createTestDb } from '@hakit/db/testing';
import type { Env } from '../env';
import { databaseWebhookDependencies, processGithubWebhook } from './github-webhook';
import { databaseBackfillDependencies } from './github-backfill';
import { prFixture, pushFixture, receivedAt } from '../services/github/fixtures.test-data';
import { installation } from '../services/github/t402.test-data';

const project = '10000000-0000-4000-8000-000000000001';
const user = '20000000-0000-4000-8000-000000000001';
const task = '30000000-0000-4000-8000-000000000012';
const job = {
  type: 'github.webhook' as const,
  deliveryId: 'delivery-1',
  event: 'push',
  payload: pushFixture,
};

async function setup() {
  const { db } = createTestDb();
  await db.insert(schema.users).values({ id: user, githubUserId: 200, githubLogin: 'author' });
  const [ws] = await db
    .insert(schema.workspaces)
    .values({ name: 'W', slug: 'w', deadlineAt: new Date(receivedAt), createdBy: user })
    .returning();
  await db.insert(schema.projects).values({ id: project, workspaceId: ws!.id, name: 'P' });
  await db.insert(schema.githubInstallations).values({
    id: installation.id,
    accountLogin: 'team',
    accountType: 'Organization',
    repositorySelection: 'selected',
    updatedAt: new Date(0),
  });
  await db.insert(schema.repos).values({
    id: 42,
    installationId: installation.id,
    fullName: 'team/repo',
    htmlUrl: 'https://github.com/team/repo',
    updatedAt: new Date(0),
  });
  await db.insert(schema.projectRepos).values({ projectId: project, repoId: 42 });
  await db.insert(schema.tasks).values({ id: task, projectId: project, number: 12, title: 'Feature' });
  const broadcast = vi.fn(async () => {});
  const send = vi.fn(async () => {});
  const env = {
    JOBS: { send },
    PROJECT_ROOM: { idFromName: (id: string) => id, get: () => ({ broadcast }) },
  } as unknown as Env;
  const deliver = (id: string, event = 'push') =>
    db.insert(schema.webhookDeliveries).values({ deliveryId: id, event, receivedAt: new Date(receivedAt) });
  const activity = () => db.select().from(schema.activityEvents);
  const ledger = async (id: string) =>
    (await db.select().from(schema.webhookDeliveries).where(eq(schema.webhookDeliveries.deliveryId, id)))[0];
  return { db: db as Db, env, broadcast, send, deliver, activity, ledger };
}

describe('GitHub webhook database adapter (in-memory D1)', () => {
  it('stores attributed, linked activity in one batch, then broadcasts and marks the delivery', async () => {
    const s = await setup();
    await s.deliver('delivery-1');
    await processGithubWebhook(job, databaseWebhookDependencies(s.db, s.env));
    const rows = await s.activity();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      projectId: project,
      actorUserId: user,
      sha: 'abc123',
      taskId: task,
      linkKind: 'confirmed',
      ts: new Date('2026-10-10T14:00:00Z'),
    });
    expect(s.broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: 'activity.created' }));
    // Confirmed from the branch reference, so no inferred-link job.
    expect(s.send).not.toHaveBeenCalled();
    expect((await s.ledger('delivery-1'))!.processedAt).toBeInstanceOf(Date);
  });
  it('skips a commit another delivery already stored, even at a different timestamp', async () => {
    const s = await setup();
    await s.deliver('delivery-1');
    await s.deliver('delivery-2');
    await processGithubWebhook(job, databaseWebhookDependencies(s.db, s.env));
    const later = { ...pushFixture, commits: [{ ...pushFixture.commits[0]!, timestamp: receivedAt }] };
    await processGithubWebhook(
      { ...job, deliveryId: 'delivery-2', payload: later },
      databaseWebhookDependencies(s.db, s.env),
    );
    expect(await s.activity()).toHaveLength(1);
    expect(s.broadcast).toHaveBeenCalledTimes(1);
    expect((await s.ledger('delivery-2'))!.processedAt).toBeInstanceOf(Date);
  });
  it('re-announces its own stored events when a failed notification is retried', async () => {
    const s = await setup();
    await s.deliver('delivery-1');
    s.broadcast.mockRejectedValueOnce(new Error('room unavailable'));
    const deps = databaseWebhookDependencies(s.db, s.env);
    await expect(processGithubWebhook(job, deps)).rejects.toThrow('room unavailable');
    expect((await s.ledger('delivery-1'))!.processedAt).toBeNull();
    await processGithubWebhook(job, deps);
    expect(await s.activity()).toHaveLength(1);
    expect(s.broadcast).toHaveBeenCalledTimes(2);
  });
  it('queues inferred linking for events without a reference', async () => {
    const s = await setup();
    await s.deliver('pr-1', 'pull_request');
    const pr = {
      ...prFixture,
      pull_request: { ...prFixture.pull_request, title: 'x', head: { ref: 'main', sha: 'f' } },
    };
    await processGithubWebhook(
      { ...job, deliveryId: 'pr-1', event: 'pull_request', payload: pr },
      databaseWebhookDependencies(s.db, s.env),
    );
    const [row] = await s.activity();
    expect(row).toMatchObject({ kind: 'pr_opened', linkKind: 'none' });
    expect(s.send).toHaveBeenCalledWith({ type: 'activity.link', eventId: row!.id, projectId: project });
  });
  it('skips a processed delivery without activity writes or notifications', async () => {
    const s = await setup();
    await s.deliver('delivery-1');
    await s.db
      .update(schema.webhookDeliveries)
      .set({ processedAt: new Date() })
      .where(eq(schema.webhookDeliveries.deliveryId, 'delivery-1'));
    await processGithubWebhook(job, databaseWebhookDependencies(s.db, s.env));
    expect(await s.activity()).toEqual([]);
    expect(s.broadcast).not.toHaveBeenCalled();
  });
  it('retries when a queue message arrives before the delivery ledger row', async () => {
    const s = await setup();
    await expect(processGithubWebhook(job, databaseWebhookDependencies(s.db, s.env))).rejects.toThrow(
      'ledger entry not yet available',
    );
    expect(await s.activity()).toEqual([]);
  });
  it('does not store activity for repos of a suspended installation', async () => {
    const s = await setup();
    await s.deliver('delivery-1');
    await s.db
      .update(schema.githubInstallations)
      .set({ suspendedAt: new Date(receivedAt) })
      .where(eq(schema.githubInstallations.id, installation.id));
    await processGithubWebhook(job, databaseWebhookDependencies(s.db, s.env));
    expect(await s.activity()).toEqual([]);
    expect((await s.ledger('delivery-1'))!.processedAt).toBeInstanceOf(Date);
  });
});

describe('GitHub lifecycle synchronization (in-memory D1)', () => {
  const removed = {
    action: 'removed',
    installation,
    repository_selection: 'selected',
    repositories_removed: [{ id: 42 }],
  };
  it('applies a lifecycle delivery in one batch and marks it processed', async () => {
    const s = await setup();
    await s.deliver('install-1', 'installation_repositories');
    await processGithubWebhook(
      { ...job, deliveryId: 'install-1', event: 'installation_repositories', payload: removed },
      databaseWebhookDependencies(s.db, s.env),
    );
    const [repo] = await s.db.select().from(schema.repos);
    expect(repo).toMatchObject({ installationId: null, updatedAt: new Date(receivedAt) });
    const [inst] = await s.db.select().from(schema.githubInstallations);
    expect(inst!.updatedAt).toEqual(new Date(receivedAt));
    expect((await s.ledger('install-1'))!.processedAt).toBeInstanceOf(Date);
    expect(s.broadcast).not.toHaveBeenCalled();
  });
  it('never lets an older delivery overwrite a newer installation state', async () => {
    const s = await setup();
    const newer = new Date('2026-10-10T13:00:00Z');
    await s.db
      .update(schema.githubInstallations)
      .set({ updatedAt: newer, suspendedAt: newer })
      .where(eq(schema.githubInstallations.id, installation.id));
    await s.deliver('install-1', 'installation');
    await processGithubWebhook(
      {
        ...job,
        deliveryId: 'install-1',
        event: 'installation',
        payload: { action: 'unsuspend', installation },
      },
      databaseWebhookDependencies(s.db, s.env),
    );
    const [inst] = await s.db.select().from(schema.githubInstallations);
    expect(inst).toMatchObject({ updatedAt: newer, suspendedAt: newer });
  });
});

describe('GitHub backfill save (in-memory D1)', () => {
  it('inserts only events without a stored equivalent and returns just those', async () => {
    const s = await setup();
    await s.deliver('delivery-1');
    await processGithubWebhook(job, databaseWebhookDependencies(s.db, s.env));
    const deps = databaseBackfillDependencies(s.db, s.env);
    const base = {
      ts: '2026-10-10T09:00:00.000Z',
      projectId: project,
      source: 'github' as const,
      actorUserId: null,
      actorRaw: 'author',
      repoId: 42,
      ref: 'main',
      sha: null,
      prNumber: null,
      taskId: null,
      linkKind: 'none' as const,
      linkConfidence: null,
      title: 't',
      url: null,
      additions: null,
      deletions: null,
      agentSessionId: null,
    };
    const commit = { ...base, id: crypto.randomUUID(), kind: 'commit' as const, sha: 'abc123' };
    const pr = { ...base, id: crypto.randomUUID(), kind: 'pr_opened' as const, prNumber: 7 };
    const samePr = { ...pr, id: crypto.randomUUID() };
    const saved = await deps.save([commit, pr, samePr]);
    expect(saved.map((e) => e.id)).toEqual([pr.id]);
    expect(await s.activity()).toHaveLength(2);
    expect(await deps.save([pr])).toEqual([]);
  });
});
