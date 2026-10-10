import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { schema } from '@hakit/db';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../test/pglite';
import { importSkillFacts, processSkillsImport, skillsImportJob } from './skills-import';
import { getServices } from '../services';
import type { Env } from '../env';
import { handlers, handleQueue } from './index';
import type { RepoFacts } from '@hakit/engine';
let testDb: Awaited<ReturnType<typeof createTestDb>>;
let userId: string, skillId: string;
const now = new Date('2026-10-10');
const repo: RepoFacts = {
  fullName: 'member/app',
  url: 'https://github.com/member/app',
  pushedAt: now,
  sizeKb: 750,
  isFork: false,
  languages: { TypeScript: 100 },
  topics: [],
  files: {},
  readmeExcerpt: null,
};
const provider = {
  name: 'hf' as const,
  model: 'Qwen/Qwen3-Embedding-0.6B',
  dim: 1024,
  embed: vi.fn(async (texts: string[]) =>
    texts.map(() => Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0))),
  ),
};
beforeAll(async () => {
  testDb = await createTestDb();
}, 30000);
afterAll(async () => {
  await testDb.pg.close();
});
beforeEach(async () => {
  await testDb.pg.exec('TRUNCATE users, skills CASCADE');
  vi.clearAllMocks();
  const [user] = await testDb.db
    .insert(schema.users)
    .values({ githubUserId: 1, githubLogin: 'member' })
    .returning();
  userId = user!.id;
  const [skill] = await testDb.db
    .insert(schema.skills)
    .values({ slug: 'typescript', name: 'TypeScript', category: 'backend', aliases: [] })
    .returning();
  skillId = skill!.id;
});
it('persists inferred rows and reimports without duplicate evidence', async () => {
  const progress = vi.fn(async () => {});
  await importSkillFacts(testDb.db, userId, [repo], provider, now, progress);
  await importSkillFacts(testDb.db, userId, [repo], provider, now, progress);
  expect(await testDb.db.select().from(schema.memberSkills)).toHaveLength(1);
  expect(await testDb.db.select().from(schema.skillEvidence)).toHaveLength(1);
  expect(progress.mock.calls.length).toBe(6);
});
it.each(['confirmed', 'self_added', 'removed', 'task_history'] as const)(
  'preserves %s rows and their evidence',
  async (source) => {
    await testDb.db.insert(schema.memberSkills).values({ userId, skillId, source, level: 5, confidence: 1 });
    await testDb.db.insert(schema.skillEvidence).values({
      userId,
      skillId,
      kind: 'self_report',
      sourceRef: 'member',
      weight: 1,
      summary: 'My correction',
      observedAt: now,
    });
    await importSkillFacts(testDb.db, userId, [repo], provider, now, async () => {});
    const [row] = await testDb.db.select().from(schema.memberSkills);
    expect(row).toMatchObject({ source, level: 5, confidence: 1 });
    expect(await testDb.db.select().from(schema.skillEvidence)).toHaveLength(1);
  },
);
it('degrades to deterministic evidence when embedding fails', async () => {
  await testDb.db
    .update(schema.skills)
    .set({ embedding: Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0)) });
  const broken = {
    ...provider,
    embed: vi.fn(async () => {
      throw new Error('unavailable');
    }),
  };
  const result = await importSkillFacts(
    testDb.db,
    userId,
    [{ ...repo, readmeExcerpt: 'Web app' }],
    broken,
    now,
    async () => {},
  );
  expect(result.semanticUnavailable).toBe(true);
  expect(await testDb.db.select().from(schema.memberSkills)).toHaveLength(1);
});
it('uses semantic matches only for existing taxonomy skills', async () => {
  await testDb.db
    .update(schema.skills)
    .set({ embedding: Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0)) })
    .where(eq(schema.skills.id, skillId));
  await importSkillFacts(
    testDb.db,
    userId,
    [
      { ...repo, readmeExcerpt: 'Web app' },
      { ...repo, fullName: 'member/second', readmeExcerpt: 'Another web app' },
    ],
    provider,
    now,
    async () => {},
  );
  expect(
    (await testDb.db.select().from(schema.skillEvidence)).filter((e) => e.kind === 'readme_semantic'),
  ).toHaveLength(2);
});
it('empty imports do not destroy existing suggestions or confirmed skills', async () => {
  await importSkillFacts(testDb.db, userId, [repo], provider, now, async () => {});
  await importSkillFacts(testDb.db, userId, [], provider, now, async () => {});
  expect(await testDb.db.select().from(schema.memberSkills)).toHaveLength(1);
});

it('runs the 40-repo fixture pipeline, broadcasts done after commit and enqueues member embeddings', async () => {
  const [workspace] = await testDb.db
    .insert(schema.workspaces)
    .values({ name: 'Team', slug: 'skill-import', createdBy: userId, deadlineAt: new Date('2099-01-01') })
    .returning();
  await testDb.db
    .insert(schema.memberships)
    .values({ workspaceId: workspace!.id, userId, role: 'owner', colorIndex: 0 });
  await testDb.db.insert(schema.projects).values({ workspaceId: workspace!.id, name: 'Demo' });
  const events: unknown[] = [];
  const send = vi.fn(async () => {
    expect(await testDb.db.select().from(schema.memberSkills)).toHaveLength(1);
  });
  const env = {
    HAKIT_MOCKS: '0',
    EMBED_MODEL: provider.model,
    EMBED_DIM: '1024',
    WORKERS_AI_EMBED_MODEL: '@cf/qwen/qwen3-embedding-0.6b',
    JOBS: { send },
    PROJECT_ROOM: {
      idFromName: (id: string) => id,
      get: () => ({
        broadcast: async (event: unknown) => {
          events.push(event);
        },
      }),
    },
  } as unknown as Env;
  const load = vi.fn(async () =>
    Array.from({ length: 40 }, (_, i) => ({ ...repo, fullName: `member/app${i}` })),
  );
  const start = performance.now();
  await processSkillsImport(
    { type: 'skills.import', userId, workspaceId: workspace!.id, repoCursor: null },
    testDb.db,
    { env, services: getServices(env) },
    load,
  );
  expect(performance.now() - start).toBeLessThan(30000);
  expect(events).toHaveLength(6);
  expect(events.at(-1)).toMatchObject({
    type: 'skills.import_progress',
    data: { userId, progress: { stage: 'done', counts: { repos: 40, skills: 1 } } },
  });
  expect(send).toHaveBeenCalledWith({ type: 'embed.batch', target: 'member', ids: [userId] });
  expect(load).toHaveBeenCalledWith('member', null);
});
it('drops jobs for departed members before external calls', async () => {
  const load = vi.fn();
  const env = { HAKIT_MOCKS: '1' } as Env;
  await processSkillsImport(
    { type: 'skills.import', userId, workspaceId: crypto.randomUUID(), repoCursor: null },
    testDb.db,
    { env, services: getServices(env) },
    load,
  );
  expect(load).not.toHaveBeenCalled();
});
it('registers the queue handler and acknowledges mock jobs without I/O', async () => {
  expect(handlers['skills.import']).toBe(skillsImportJob);
  const message = {
    body: { type: 'skills.import', userId, workspaceId: crypto.randomUUID() },
    ack: vi.fn(),
    retry: vi.fn(),
    attempts: 1,
  };
  await handleQueue({ messages: [message] } as unknown as MessageBatch<unknown>, { HAKIT_MOCKS: '1' } as Env);
  expect(message.ack).toHaveBeenCalledOnce();
  expect(message.retry).not.toHaveBeenCalled();
});

it('replaces pipeline-owned fork contributions while preserving unrelated contribution evidence', async () => {
  await testDb.db.insert(schema.skillEvidence).values({
    userId,
    skillId,
    kind: 'contribution',
    sourceRef: 'other/real-work',
    weight: 1,
    summary: 'Independent contribution',
    observedAt: now,
  });
  const fork = { ...repo, isFork: true };
  await importSkillFacts(testDb.db, userId, [fork], provider, now, async () => {});
  await importSkillFacts(testDb.db, userId, [fork], provider, now, async () => {});
  const rows = await testDb.db.select().from(schema.skillEvidence);
  expect(rows.filter((row) => row.kind === 'contribution')).toHaveLength(2);
  expect(rows.some((row) => row.summary === 'Independent contribution')).toBe(true);
});
it('rejects missing taxonomy instead of reporting a misleading successful empty import', async () => {
  await testDb.db.delete(schema.skills);
  await expect(importSkillFacts(testDb.db, userId, [repo], provider, now, async () => {})).rejects.toThrow(
    'taxonomy is not seeded',
  );
  expect(await testDb.db.select().from(schema.memberSkills)).toHaveLength(0);
});
it.each([{ model: 'different' }, { dim: 768 }])(
  'keeps deterministic evidence and skips semantics for incompatible providers (%o)',
  async (override) => {
    const embed = vi.fn();
    const result = await importSkillFacts(
      testDb.db,
      userId,
      [{ ...repo, topics: ['web'], readmeExcerpt: 'hello' }],
      { ...provider, ...override, embed },
      now,
      async () => {},
    );
    expect(result).toEqual({ skills: 1, semanticUnavailable: true });
    expect(embed).not.toHaveBeenCalled();
    expect(await testDb.db.select().from(schema.memberSkills)).toHaveLength(1);
  },
);
it('rechecks membership before saving after a member leaves during processing', async () => {
  const [workspace] = await testDb.db
    .insert(schema.workspaces)
    .values({ name: 'Team', slug: 'left-team', createdBy: userId, deadlineAt: new Date('2099-01-01') })
    .returning();
  await testDb.db
    .insert(schema.memberships)
    .values({ workspaceId: workspace!.id, userId, role: 'owner', colorIndex: 0 });
  await expect(
    importSkillFacts(
      testDb.db,
      userId,
      [repo],
      provider,
      now,
      async (p) => {
        if (p.stage === 'aggregating')
          await testDb.db.delete(schema.memberships).where(eq(schema.memberships.workspaceId, workspace!.id));
      },
      workspace!.id,
    ),
  ).rejects.toThrow('membership changed');
  expect(await testDb.db.select().from(schema.memberSkills)).toHaveLength(0);
});
it('saves suggestions even when realtime broadcasts fail', async () => {
  const [workspace] = await testDb.db
    .insert(schema.workspaces)
    .values({ name: 'Team', slug: 'realtime-down', createdBy: userId, deadlineAt: new Date('2099-01-01') })
    .returning();
  await testDb.db
    .insert(schema.memberships)
    .values({ workspaceId: workspace!.id, userId, role: 'owner', colorIndex: 0 });
  await testDb.db.insert(schema.projects).values({ workspaceId: workspace!.id, name: 'Demo' });
  const send = vi.fn(async () => {});
  const env = {
    HAKIT_MOCKS: '0',
    EMBED_MODEL: provider.model,
    EMBED_DIM: '1024',
    JOBS: { send },
    PROJECT_ROOM: {
      idFromName: (id: string) => id,
      get: () => ({
        broadcast: async () => {
          throw new Error('realtime down');
        },
      }),
    },
  } as unknown as Env;
  await processSkillsImport(
    { type: 'skills.import', userId, workspaceId: workspace!.id, repoCursor: null },
    testDb.db,
    { env, services: getServices(env) },
    async () => [repo],
  );
  expect(await testDb.db.select().from(schema.memberSkills)).toHaveLength(1);
  expect(send).toHaveBeenCalledOnce();
});
it('reports success when the embedding refresh cannot be enqueued after commit', async () => {
  const [workspace] = await testDb.db
    .insert(schema.workspaces)
    .values({ name: 'Team', slug: 'queue-down', createdBy: userId, deadlineAt: new Date('2099-01-01') })
    .returning();
  await testDb.db
    .insert(schema.memberships)
    .values({ workspaceId: workspace!.id, userId, role: 'owner', colorIndex: 0 });
  await testDb.db.insert(schema.projects).values({ workspaceId: workspace!.id, name: 'Demo' });
  const events: { data: { progress: { stage: string } } }[] = [];
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const env = {
    HAKIT_MOCKS: '0',
    EMBED_MODEL: provider.model,
    EMBED_DIM: '1024',
    JOBS: {
      send: vi.fn(async () => {
        throw new Error('queue down');
      }),
    },
    PROJECT_ROOM: {
      idFromName: (id: string) => id,
      get: () => ({ broadcast: async (e: (typeof events)[number]) => void events.push(e) }),
    },
  } as unknown as Env;
  await processSkillsImport(
    { type: 'skills.import', userId, workspaceId: workspace!.id, repoCursor: null },
    testDb.db,
    { env, services: getServices(env) },
    async () => [repo],
  );
  expect(await testDb.db.select().from(schema.memberSkills)).toHaveLength(1);
  expect(events.at(-1)?.data.progress.stage).toBe('done');
  expect(events.some((e) => e.data.progress.stage === 'error')).toBe(false);
  expect(warn).toHaveBeenCalledOnce();
  warn.mockRestore();
});
