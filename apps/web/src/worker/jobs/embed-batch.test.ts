/** Integration tests run against local WASM Postgres with fake providers; never Tiger or HF. */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema } from '@hakit/db';
import type { JobMessage } from '@hakit/contracts';
import { createTestDb } from '../test/pglite';
import { databaseEmbeddingCache, cachedEmbeddings, QWEN_MODEL } from '../services/embeddings';
import { processEmbeddingBatch, embedBatchJob } from './embed-batch';
import { handleQueue, handlers } from './index';
import type { Env } from '../env';

let testDb: Awaited<ReturnType<typeof createTestDb>>;
let userId: string, workspaceId: string, projectId: string;
const vector = (index = 0): number[] => Array.from({ length: 1024 }, (_, i) => (i === index ? 1 : 0));
const provider = () => ({
  name: 'hf' as const,
  model: QWEN_MODEL,
  dim: 1024,
  embed: vi.fn(async (texts: string[]) => texts.map(() => vector())),
});
const job = (target: 'task' | 'member' | 'skill', ids: string[]) => ({
  type: 'embed.batch' as const,
  target,
  ids,
});
beforeAll(async () => {
  testDb = await createTestDb();
}, 30_000);
afterAll(async () => {
  await testDb.pg.close();
});
beforeEach(async () => {
  vi.restoreAllMocks();
  // Destructive reset applies only to this test's isolated, in-memory database.
  await testDb.pg.exec('TRUNCATE users, skills, embedding_cache CASCADE');
  const [user] = await testDb.db
    .insert(schema.users)
    .values({ githubUserId: 1, githubLogin: 'member' })
    .returning();
  userId = user!.id;
  const [workspace] = await testDb.db
    .insert(schema.workspaces)
    .values({ name: 'Team', slug: 'team', createdBy: userId, deadlineAt: new Date('2099-01-01') })
    .returning();
  workspaceId = workspace!.id;
  await testDb.db.insert(schema.memberships).values({ userId, workspaceId });
  const [project] = await testDb.db.insert(schema.projects).values({ name: 'Demo', workspaceId }).returning();
  projectId = project!.id;
});
async function addTask(number = 1) {
  const [task] = await testDb.db
    .insert(schema.tasks)
    .values({
      projectId,
      number,
      title: `Build UI ${number}`,
      description: 'React frontend',
      acceptanceCriteria: ['Accessible'],
      requiredSkills: [{ skillSlug: 'react', level: 2, weight: 1 }],
    })
    .returning();
  return task!;
}
async function addSkill(slug = 'react') {
  const [skill] = await testDb.db
    .insert(schema.skills)
    .values({ slug, name: slug, category: 'frontend', aliases: ['UI'] })
    .returning();
  return skill!;
}
describe('embedding DB cache and batch jobs', () => {
  it('persists cache hits and replaces corrupt rows using the real schema', async () => {
    const cache = databaseEmbeddingCache(testDb.db);
    await cache.put(QWEN_MODEL, [{ hash: 'hash', embedding: vector() }]);
    expect((await cache.get(QWEN_MODEL, ['hash']))[0]!.embedding).toEqual(vector());
    expect(await cache.get('other', ['hash'])).toEqual([]);
    await cache.put(QWEN_MODEL, [{ hash: 'hash', embedding: vector(1) }]);
    expect((await cache.get(QWEN_MODEL, ['hash']))[0]!.embedding[1]).toBe(1);
  });
  it('processes tasks idempotently as queries and reuses persisted cache on redelivery', async () => {
    const task = await addTask();
    const raw = provider();
    const service = cachedEmbeddings(raw, databaseEmbeddingCache(testDb.db));
    await processEmbeddingBatch(job('task', [task.id, task.id]), testDb.db, service);
    await processEmbeddingBatch(job('task', [task.id]), testDb.db, service);
    expect(raw.embed).toHaveBeenCalledTimes(1);
    expect(raw.embed.mock.calls[0]![0][0]).toContain('react: level 2');
    const [saved] = await testDb.db.select().from(schema.tasks);
    expect(saved!.embedding).toHaveLength(1024);
    expect(saved!.updatedAt).toEqual(task.updatedAt);
  });
  it('embeds the skill taxonomy as documents', async () => {
    const skill = await addSkill();
    const p = provider();
    await processEmbeddingBatch(job('skill', [skill.id]), testDb.db, p);
    expect(p.embed).toHaveBeenCalledWith([expect.stringContaining('frontend')], 'document');
    expect((await testDb.db.select().from(schema.skills))[0]!.embedding).toHaveLength(1024);
  });
  it('writes both member vector kinds per workspace without re-adding removed skills', async () => {
    const skill = await addSkill();
    const removed = await addSkill('removed-skill');
    await testDb.db.insert(schema.memberProfiles).values({
      userId,
      workspaceId,
      headline: 'UI developer',
      interests: ['games'],
      learningGoals: ['react'],
    });
    await testDb.db.insert(schema.memberSkills).values([
      { userId, skillId: skill.id, level: 3, confidence: 0.9, source: 'confirmed' },
      { userId, skillId: removed.id, level: 4, confidence: 1, source: 'removed' },
    ]);
    const p = provider();
    await processEmbeddingBatch(job('member', [userId]), testDb.db, p);
    await processEmbeddingBatch(job('member', [userId]), testDb.db, p);
    expect(p.embed.mock.calls[0]![0].join(' ')).toContain('react: level 3');
    expect(p.embed.mock.calls[0]![0].join(' ')).not.toContain('removed-skill');
    const saved = await testDb.db.select().from(schema.memberEmbeddings);
    expect(saved).toHaveLength(2);
    expect(saved.map((row) => row.kind).sort()).toEqual(['interests', 'profile']);
    expect(saved.every((row) => row.model === QWEN_MODEL && row.embedding.length === 1024)).toBe(true);
  });
  it('does not embed a departed member whose profile remains', async () => {
    await testDb.db.insert(schema.memberProfiles).values({ userId, workspaceId });
    await testDb.db.delete(schema.memberships);
    const p = provider();
    await processEmbeddingBatch(job('member', [userId]), testDb.db, p);
    expect(p.embed).not.toHaveBeenCalled();
  });
  it('splits large batches into provider-safe chunks', async () => {
    const rows = await testDb.db
      .insert(schema.tasks)
      .values(Array.from({ length: 35 }, (_, i) => ({ projectId, number: i + 1, title: 'Task ' + i })))
      .returning();
    const p = provider();
    await processEmbeddingBatch(
      job(
        'task',
        rows.map((row) => row.id),
      ),
      testDb.db,
      p,
    );
    expect(p.embed.mock.calls.map((call) => call[0].length)).toEqual([32, 3]);
  });
  it('skips deleted rows and rejects malformed identifiers or mismatched models', async () => {
    const p = provider();
    await processEmbeddingBatch(job('task', [crypto.randomUUID()]), testDb.db, p);
    expect(p.embed).not.toHaveBeenCalled();
    await expect(processEmbeddingBatch(job('task', ['bad']), testDb.db, p)).rejects.toThrow();
    await expect(
      processEmbeddingBatch(job('task', [crypto.randomUUID()]), testDb.db, { ...p, model: 'other' }),
    ).rejects.toMatchObject({ code: 'configuration' });
  });
  it('writes nothing on provider failure or invalid vectors', async () => {
    const task = await addTask();
    const p = provider();
    p.embed.mockRejectedValue(new Error('down'));
    await expect(processEmbeddingBatch(job('task', [task.id]), testDb.db, p)).rejects.toThrow();
    p.embed.mockResolvedValue([[1, 2]]);
    await expect(processEmbeddingBatch(job('task', [task.id]), testDb.db, p)).rejects.toThrow();
    expect((await testDb.db.select().from(schema.tasks))[0]!.embedding).toBeNull();
  });
  it('retries instead of persisting stale task content', async () => {
    const task = await addTask();
    const p = provider();
    p.embed.mockImplementation(async () => {
      await testDb.db
        .update(schema.tasks)
        .set({ title: 'Changed', updatedAt: new Date(task.updatedAt.getTime() + 1000) })
        .where(eq(schema.tasks.id, task.id));
      return [vector()];
    });
    await expect(processEmbeddingBatch(job('task', [task.id]), testDb.db, p)).rejects.toThrow(
      'source changed',
    );
    expect((await testDb.db.select().from(schema.tasks))[0]!.embedding).toBeNull();
  });
  it('does not recreate a source deleted during inference', async () => {
    const task = await addTask();
    const p = provider();
    p.embed.mockImplementation(async () => {
      await testDb.db.delete(schema.tasks).where(eq(schema.tasks.id, task.id));
      return [vector()];
    });
    await processEmbeddingBatch(job('task', [task.id]), testDb.db, p);
    expect(await testDb.db.select().from(schema.tasks)).toEqual([]);
  });
  it('registers the handler and retries queue messages when embedding processing fails', async () => {
    expect(handlers['embed.batch']).toBe(embedBatchJob);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(handlers, 'embed.batch').mockRejectedValue(new Error('down'));
    const message = {
      body: job('task', [crypto.randomUUID()]) as JobMessage,
      attempts: 1,
      ack: vi.fn(),
      retry: vi.fn(),
    };
    await handleQueue(
      { messages: [message] } as unknown as MessageBatch<unknown>,
      { HAKIT_MOCKS: '1', EMBED_DIM: '1024' } as Env,
    );
    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 2 });
    expect(message.ack).not.toHaveBeenCalled();
  });
  it('does no database/network work in mock queue mode', async () => {
    await expect(
      embedBatchJob(job('task', [crypto.randomUUID()]), { env: { HAKIT_MOCKS: '1' } as Env }),
    ).resolves.toBeUndefined();
  });
});
