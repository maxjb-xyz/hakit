/**
 * Per-workspace daily AI limits (services/ai/usage.ts), in real mode on the in-memory D1 harness:
 * counting by tier, the limit sending each AI path down its existing fallback, the 00:00 UTC reset, and
 * unlimited when AI_DAILY_LIMIT_PER_WORKSPACE is unset or "0".
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { AiUsage, IdeaStreamEvent, PlanStreamEvent } from '@hakit/contracts';
import { planDocument } from '@hakit/contracts/fixtures';
import { schema } from '@hakit/db';
import { createHarness } from '../../test/harness';
import { processEmbeddingBatch } from '../../jobs/embed-batch';
import {
  cachedEmbeddings,
  databaseEmbeddingCache,
  EmbeddingError,
  QWEN_DIM,
  QWEN_MODEL,
} from '../embeddings';
import { LlmError } from './structured';
import type { EmbeddingProvider, LlmProvider } from './types';
import {
  AI_UNITS,
  AiQuotaError,
  dailyLimit,
  EmbeddingQuotaError,
  meteredEmbeddings,
  meteredLlm,
  readUsage,
  usageDay,
  workspaceMeter,
} from './usage';

let h: Awaited<ReturnType<typeof createHarness>>;
let owner: Awaited<ReturnType<typeof h.signIn>>;
let wid: string, pid: string, ideaId: string, taskId: string;

const llm: LlmProvider = {
  name: 'workers_ai',
  generateStructured: vi.fn(async () => {
    throw new LlmError('http', false, 503);
  }),
};
const vector = (seed: number) => Array.from({ length: QWEN_DIM }, (_, i) => ((i + seed) % 7) + 1);
const embedder = (): EmbeddingProvider => ({
  name: 'workers_ai',
  model: QWEN_MODEL,
  dim: QWEN_DIM,
  embed: vi.fn(async (texts: string[]) => texts.map((_, i) => vector(i))),
});

beforeAll(async () => {
  h = await createHarness({ llm });
  owner = await h.signIn(7101, 'quota-owner');
  await h.db.insert(schema.skills).values({ slug: 'react', name: 'React', category: 'frontend' });
  const [react] = await h.db.select().from(schema.skills).where(eq(schema.skills.slug, 'react'));
  await h.db
    .insert(schema.memberSkills)
    .values({ userId: owner.id, skillId: react!.id, level: 4, confidence: 1, source: 'confirmed' });
}, 30_000);

beforeEach(async () => {
  delete h.env.AI_DAILY_LIMIT_PER_WORKSPACE;
  vi.mocked(llm.generateStructured).mockReset();
  vi.mocked(llm.generateStructured).mockImplementation(async () => {
    throw new LlmError('http', false, 503);
  });
  const now = new Date();
  const [w] = await h.db
    .insert(schema.workspaces)
    .values({
      name: 'Quota',
      slug: crypto.randomUUID(),
      createdBy: owner.id,
      startsAt: now,
      deadlineAt: new Date(now.getTime() + 48 * 3_600_000),
    })
    .returning();
  wid = w!.id;
  await h.db.insert(schema.memberships).values({ workspaceId: wid, userId: owner.id, role: 'owner' });
  await h.db.insert(schema.memberProfiles).values({ workspaceId: wid, userId: owner.id, availableHours: 30 });
  const [p] = await h.db.insert(schema.projects).values({ workspaceId: wid, name: 'Quota' }).returning();
  pid = p!.id;
  const idea = {
    ...planDocument.idea,
    stack: [{ component: 'Web frontend', tech: 'React', skillSlugs: ['react'] }],
  };
  const [i] = await h.db
    .insert(schema.ideas)
    .values({ projectId: pid, title: idea.title, pitch: idea.pitch, payload: idea, source: 'user' })
    .returning();
  ideaId = i!.id;
  const [t] = await h.db
    .insert(schema.tasks)
    .values({
      projectId: pid,
      number: 1,
      title: 'Build UI',
      estimateHours: 2,
      requiredSkills: [{ skillSlug: 'react', level: 3, weight: 1 }],
    })
    .returning();
  taskId = t!.id;
});

const post = (path: string, json: unknown = {}) => h.call(path, { method: 'POST', json, token: owner.token });
async function usage(workspaceId = wid) {
  const res = await h.call(`/w/${workspaceId}/ai/usage`, { token: owner.token });
  expect(res.status).toBe(200);
  return AiUsage.parse(await res.json());
}
async function row(workspaceId = wid, day = usageDay(new Date())) {
  const [r] = await h.db
    .select()
    .from(schema.aiUsage)
    .where(and(eq(schema.aiUsage.workspaceId, workspaceId), eq(schema.aiUsage.day, day)));
  return r;
}
const sse = async (res: Response) =>
  (await res.text())
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => JSON.parse(line.slice(5)) as unknown);
async function generatePlan() {
  const res = await post(`/projects/${pid}/plans/generate`, { ideaId });
  expect(res.status).toBe(200);
  return (await sse(res)).map((e) => PlanStreamEvent.parse(e));
}

describe('counting', () => {
  it('charges plan-tier and fast-tier calls per workspace and reports them', async () => {
    expect(await usage()).toMatchObject({ used: 0, limit: null });
    // The provider fails, so the plan falls back to a template; the outline call was still made and counts.
    const events = await generatePlan();
    expect(events.some((e) => e.type === 'done')).toBe(true);
    expect(llm.generateStructured).toHaveBeenCalledTimes(1);
    expect(await row()).toMatchObject({ units: AI_UNITS.plan, calls: 1 });

    // Solving polishes explanations with one fast-tier call (after the response, in waitUntil).
    expect((await post(`/projects/${pid}/assignments/solve`)).status).toBe(200);
    expect(await row()).toMatchObject({ units: AI_UNITS.plan + AI_UNITS.fast, calls: 2 });

    const today = await usage();
    expect(today).toMatchObject({ day: usageDay(new Date()), used: 12, limit: null });
    expect(Date.parse(today.resetsAt) - Date.now()).toBeLessThanOrEqual(86_400_000);
    expect(new Date(today.resetsAt).toISOString()).toMatch(/T00:00:00\.000Z$/);

    // Another workspace's counter is untouched.
    const [other] = await h.db
      .insert(schema.workspaces)
      .values({ name: 'Other', slug: crypto.randomUUID(), createdBy: owner.id, deadlineAt: new Date() })
      .returning();
    await h.db.insert(schema.memberships).values({ workspaceId: other!.id, userId: owner.id });
    expect((await usage(other!.id)).used).toBe(0);
  });

  it('charges embedding requests only on cache misses', async () => {
    const provider = embedder();
    const meter = workspaceMeter(h.db, h.env, wid);
    const cached = cachedEmbeddings(meteredEmbeddings(provider, meter), databaseEmbeddingCache(h.db));
    await cached.embed(['alpha', 'beta'], 'document');
    await cached.embed(['alpha', 'beta'], 'document');
    expect(provider.embed).toHaveBeenCalledTimes(1);
    expect(await row()).toMatchObject({ units: AI_UNITS.embed, calls: 1 });
  });

  it('never lets concurrent charges pass the limit', async () => {
    h.env.AI_DAILY_LIMIT_PER_WORKSPACE = '10';
    const meter = workspaceMeter(h.db, h.env, wid);
    const results = await Promise.all(Array.from({ length: 25 }, () => meter.charge(1)));
    expect(results.filter(Boolean)).toHaveLength(10);
    expect(await row()).toMatchObject({ units: 10, calls: 10 });
    // A call heavier than what's left is refused without recording anything.
    expect(await workspaceMeter(h.db, h.env, wid).charge(11)).toBe(false);
    expect((await row())!.units).toBe(10);
  });
});

describe('over the limit', () => {
  it('falls back to a template plan without calling the provider', async () => {
    h.env.AI_DAILY_LIMIT_PER_WORKSPACE = '15';
    await h.db.insert(schema.aiUsage).values({ workspaceId: wid, day: usageDay(new Date()), units: 10 });
    const events = await generatePlan();
    const done = events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(llm.generateStructured).not.toHaveBeenCalled();
    const [plan] = await h.db.select().from(schema.plans).where(eq(schema.plans.projectId, pid));
    expect(plan!.model).toBe('template');
    expect((await row())!.units).toBe(10);

    // A fast-tier call still fits (10 + 2 <= 15), so explanations may use the provider.
    vi.mocked(llm.generateStructured).mockClear();
    expect((await post(`/projects/${pid}/assignments/solve`)).status).toBe(200);
    expect(llm.generateStructured).toHaveBeenCalledTimes(1);
    expect((await row())!.units).toBe(12);
  });

  it('keeps template explanations when even a fast-tier call does not fit', async () => {
    h.env.AI_DAILY_LIMIT_PER_WORKSPACE = '5';
    await h.db.insert(schema.aiUsage).values({ workspaceId: wid, day: usageDay(new Date()), units: 4 });
    const res = await post(`/projects/${pid}/assignments/solve`);
    expect(res.status).toBe(200);
    expect(llm.generateStructured).not.toHaveBeenCalled();
    const [a] = await h.db.select().from(schema.assignments).where(eq(schema.assignments.taskId, taskId));
    expect(a!.explanationSource).toBe('template');
    expect((await usage()).used).toBe(4);
  });

  it('gives ideas the same friendly error as an unavailable provider', async () => {
    h.env.AI_DAILY_LIMIT_PER_WORKSPACE = '15';
    const ideas = async () => {
      const res = await post(`/projects/${pid}/ideas/generate`, { count: 2 });
      expect(res.status).toBe(200);
      return (await sse(res)).map((e) => IdeaStreamEvent.parse(e)).at(-1);
    };
    // Under the limit the (failing) provider is called and the error is the unavailable-provider one ...
    expect(await ideas()).toMatchObject({ type: 'error', code: 'ideas_unavailable' });
    expect(llm.generateStructured).toHaveBeenCalledTimes(1);
    // ... and over it (10 + 10 > 15) the same event arrives without a provider call.
    expect(await ideas()).toMatchObject({ type: 'error', code: 'ideas_unavailable' });
    expect(llm.generateStructured).toHaveBeenCalledTimes(1);
    expect((await row())!.units).toBe(10);
  });

  it('raises the errors the routers raise when providers are rate limited', async () => {
    h.env.AI_DAILY_LIMIT_PER_WORKSPACE = '1';
    const meter = workspaceMeter(h.db, h.env, wid);
    const error = await meteredLlm(llm, meter)
      .generateStructured({ task: 'plan.outline', tier: 'plan', system: '', input: {}, schema: AiUsage })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiQuotaError);
    expect(error).toBeInstanceOf(LlmError);
    expect(error).toMatchObject({ code: 'unavailable', status: 429 });

    const provider = embedder();
    expect(await meter.charge(1)).toBe(true);
    const embedError = await meteredEmbeddings(provider, meter)
      .embed(['x'], 'query')
      .catch((e: unknown) => e);
    expect(embedError).toBeInstanceOf(EmbeddingQuotaError);
    expect(embedError).toBeInstanceOf(EmbeddingError);
    expect(embedError).toMatchObject({ code: 'unavailable' });
    expect(provider.embed).not.toHaveBeenCalled();
  });

  it('embed.batch skips an over-limit workspace instead of failing the job', async () => {
    h.env.AI_DAILY_LIMIT_PER_WORKSPACE = '1';
    await h.db.insert(schema.aiUsage).values({ workspaceId: wid, day: usageDay(new Date()), units: 1 });
    const provider = embedder();
    const job = { type: 'embed.batch' as const, target: 'task' as const, ids: [taskId] };
    await processEmbeddingBatch(job, h.db, provider, (workspaceId) =>
      meteredEmbeddings(provider, workspaceMeter(h.db, h.env, workspaceId)),
    );
    expect(provider.embed).not.toHaveBeenCalled();
    const [task] = await h.db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId));
    expect(task!.embedding).toBeNull();
  });
});

describe('daily reset', () => {
  it('starts a new counter at 00:00 UTC', async () => {
    h.env.AI_DAILY_LIMIT_PER_WORKSPACE = '10';
    let clock = new Date('2026-03-01T23:59:30Z');
    const meter = workspaceMeter(h.db, h.env, wid, () => clock);
    expect(await meter.charge(10)).toBe(true);
    expect(await meter.charge(1)).toBe(false);
    expect(await readUsage(h.db, h.env, wid, clock)).toEqual({
      day: '2026-03-01',
      used: 10,
      limit: 10,
      resetsAt: '2026-03-02T00:00:00.000Z',
    });
    clock = new Date('2026-03-02T00:00:05Z');
    expect(await readUsage(h.db, h.env, wid, clock)).toMatchObject({ day: '2026-03-02', used: 0 });
    expect(await meter.charge(AI_UNITS.plan)).toBe(true);
    expect(await row(wid, '2026-03-02')).toMatchObject({ units: 10, calls: 1 });
    expect(await row(wid, '2026-03-01')).toMatchObject({ units: 10, calls: 1 });
  });
});

describe('unlimited', () => {
  it.each([undefined, '', '0', ' 0 ', 'abc', '-5'])('treats %j as no limit', (value) => {
    expect(dailyLimit({ AI_DAILY_LIMIT_PER_WORKSPACE: value })).toBeNull();
  });
  it('parses a positive limit', () => {
    expect(dailyLimit({ AI_DAILY_LIMIT_PER_WORKSPACE: '200' })).toBe(200);
  });

  it('still counts usage when unset or "0", but never refuses', async () => {
    for (const value of [undefined, '0']) {
      if (value === undefined) delete h.env.AI_DAILY_LIMIT_PER_WORKSPACE;
      else h.env.AI_DAILY_LIMIT_PER_WORKSPACE = value;
      const meter = workspaceMeter(h.db, h.env, wid);
      for (let i = 0; i < 30; i++) expect(await meter.charge(AI_UNITS.plan)).toBe(true);
    }
    expect(await row()).toMatchObject({ units: 600, calls: 60 });
    expect(await usage()).toMatchObject({ used: 600, limit: null });
    await generatePlan();
    expect(llm.generateStructured).toHaveBeenCalled();
  });
});
