/** Current migrations in local PGlite only: no shared database or provider calls. */
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { and, asc, eq } from 'drizzle-orm';
import { PlanStreamEvent, Recommendation } from '@hakit/contracts';
import { chunkRows, columnCount, schema } from '@hakit/db';
import { ALLOWED_SKILL_SLUGS, IDEAS } from '../services/ai/evals/cases';
import { scriptedPlanner } from '../services/ai/evals/providers';
import { createHarness } from '../test/harness';
import { evaluateProject } from '../jobs/recs-evaluate';

let h: Awaited<ReturnType<typeof createHarness>>;
let owner: Awaited<ReturnType<typeof h.signIn>>;
let pid: string, wid: string, ideaId: string;
const now = new Date('2026-10-10T12:01:00Z');
const generate = vi.fn(scriptedPlanner.generateStructured);
beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
  h = await createHarness({
    llm: { name: 'gemini', generateStructured: async (req) => req.schema.parse(await generate(req)) },
  });
  owner = await h.signIn(7031);
  const mate = await h.signIn(7032);
  const [w] = await h.db
    .insert(schema.workspaces)
    .values({
      name: 'Intelligence QA',
      slug: 'intelligence-qa',
      createdBy: owner.id,
      startsAt: new Date('2026-10-10T12:00:00Z'),
      deadlineAt: new Date('2026-10-12T00:00:00Z'),
    })
    .returning();
  wid = w!.id;
  await h.db.insert(schema.memberships).values([
    { workspaceId: wid, userId: owner.id, role: 'owner' },
    { workspaceId: wid, userId: mate.id },
  ]);
  await h.db
    .insert(schema.memberProfiles)
    .values([owner, mate].map((m) => ({ workspaceId: wid, userId: m.id, availableHours: 24 })));
  const skills: (typeof schema.skills.$inferSelect)[] = [];
  for (const chunk of chunkRows(
    ALLOWED_SKILL_SLUGS.map((slug) => ({ slug, name: slug, category: 'frontend' as const })),
    columnCount(schema.skills),
  ))
    skills.push(...(await h.db.insert(schema.skills).values(chunk).returning()));
  for (const chunk of chunkRows(
    [owner, mate].flatMap((m) =>
      skills.map((s) => ({
        userId: m.id,
        skillId: s.id,
        source: 'confirmed' as const,
        level: 5,
        confidence: 1,
      })),
    ),
    columnCount(schema.memberSkills),
  ))
    await h.db.insert(schema.memberSkills).values(chunk);
  const [p] = await h.db
    .insert(schema.projects)
    .values({ workspaceId: wid, name: 'QA', status: 'planning' })
    .returning();
  pid = p!.id;
  const [i] = await h.db
    .insert(schema.ideas)
    .values({
      projectId: pid,
      title: IDEAS.web.title,
      pitch: IDEAS.web.pitch,
      payload: IDEAS.web,
      source: 'user',
    })
    .returning();
  ideaId = i!.id;
}, 30_000);
afterAll(() => {
  vi.useRealTimers();
});
const plans = () =>
  h.db.select().from(schema.plans).where(eq(schema.plans.projectId, pid)).orderBy(asc(schema.plans.version));
async function requestPlan() {
  const res = await h.call(`/projects/${pid}/plans/generate`, {
    method: 'POST',
    token: owner.token,
    json: { ideaId },
  });
  expect(res.status).toBe(200);
  const events = (await res.text())
    .split('\n')
    .filter((s) => s.startsWith('data:'))
    .map((s) => PlanStreamEvent.parse(JSON.parse(s.slice(5))));
  expect(events.some((e) => e.type === 'error')).toBe(false);
  expect(events.some((e) => e.type === 'done')).toBe(true);
  return events;
}
it('persists the prompt hash and serves a second version through the real route without another model call', async () => {
  await requestPlan();
  const first = (await plans())[0]!;
  expect(first.model).toBe('gemini');
  expect(first.promptHash).toMatch(/^[a-f0-9]{64}$/);
  generate.mockClear();
  vi.setSystemTime(new Date(now.getTime() + 20_000));
  const events = await requestPlan();
  expect(generate).not.toHaveBeenCalled();
  const rows = await plans();
  expect(rows).toHaveLength(2);
  expect(rows[1]!.version).toBe(2);
  expect(rows[1]!.payload).toEqual(first.payload);
  expect(events.some((e) => e.type === 'validation')).toBe(true);
  // A changed model must generate again rather than use the previous model's result.
  h.env.AI_MODEL_PLAN = 'another-model';
  await requestPlan();
  expect(generate).toHaveBeenCalled();
});
it('reads the awaiting-input transition from stored agent summary and expires the card when it clears', async () => {
  await h.db.update(schema.projects).set({ status: 'active' }).where(eq(schema.projects.id, pid));
  const [session] = await h.db
    .insert(schema.agentSessions)
    .values({
      projectId: pid,
      workspaceId: wid,
      userId: owner.id,
      externalSessionId: 'qa-waiting',
      agent: 'claude_code',
      status: 'awaiting_input',
      lastEventAt: now,
      summary: {
        toolCounts: {},
        subagents: 0,
        awaitingSince: new Date(now.getTime() - 15 * 60_000).toISOString(),
      },
    })
    .returning();
  await evaluateProject(h.db, pid, now);
  const [r] = await h.db
    .select()
    .from(schema.recommendations)
    .where(and(eq(schema.recommendations.projectId, pid), eq(schema.recommendations.status, 'open')));
  expect(
    Recommendation.safeParse({ ...r, createdAt: r!.createdAt.toISOString(), resolvedAt: null }).success,
  ).toBe(true);
  expect(r?.dedupeKey).toContain('agent-input:');
  expect(await evaluateProject(h.db, pid, new Date(now.getTime() + 60_000))).toEqual([]);
  await h.db
    .update(schema.agentSessions)
    .set({ status: 'active' })
    .where(eq(schema.agentSessions.id, session!.id));
  const events = await evaluateProject(h.db, pid, new Date(now.getTime() + 120_000));
  expect(events.some((e) => e.type === 'recommendation.resolved')).toBe(true);
  const [resolved] = await h.db
    .select()
    .from(schema.recommendations)
    .where(eq(schema.recommendations.id, r!.id));
  expect(resolved?.status).toBe('expired');
});
