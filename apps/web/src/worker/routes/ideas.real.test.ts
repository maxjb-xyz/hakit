import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import { Idea, IdeaStreamEvent, PlanningContext, type IdeaCandidate } from '@hakit/contracts';
import { schema } from '@hakit/db';
import { and, eq } from 'drizzle-orm';
import { createHarness } from '../test/harness';
import { createApp } from '../app';
import { ideaContext } from '../services/ideas/context';
import type { LlmProvider, StructuredRequest } from '../services/ai/types';

let h: Awaited<ReturnType<typeof createHarness>>,
  owner: Awaited<ReturnType<typeof h.signIn>>,
  other: typeof owner,
  outsider: typeof owner;
let wid: string,
  pid: string,
  otherWid: string,
  otherPid: string,
  templateId: string,
  reactId: string,
  pythonId: string;
const start = '2099-10-10T00:00:00Z',
  end = '2099-10-10T06:00:00Z';
const candidate = (title = 'React demo'): IdeaCandidate => ({
  title,
  pitch: 'Help hackathon teams coordinate',
  problem: 'Coordination takes time',
  targetUser: 'Hackathon teams',
  coreFeatures: ['Team dashboard', 'Task checklist'],
  challengesAddressed: [],
  stack: [{ component: 'App', tech: 'React', skillSlugs: ['react'] }],
  complexity: 2,
  risks: ['Keep scope small'],
  whyThisTeam: ['M1 has the required frontend skills'],
});
const generate = vi.fn(async (req: StructuredRequest<z.ZodType>): Promise<unknown> =>
  req.task === 'ideas.refine'
    ? candidate('Refined demo')
    : {
        ideas: Array.from({ length: (req.input as { count: number }).count }, (_, i) =>
          candidate(`React demo ${i + 1}`),
        ),
      },
);
const llm: LlmProvider = {
  name: 'gemini',
  generateStructured: generate as LlmProvider['generateStructured'],
};
let app: ReturnType<typeof createApp>;
const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
async function call(
  path: string,
  opts: { method?: string; json?: unknown; token?: string; csrf?: boolean } = {},
) {
  const headers = new Headers();
  if (opts.token) headers.set('cookie', `hakit_session=${opts.token}`);
  if (opts.json !== undefined) headers.set('content-type', 'application/json');
  if (opts.method && opts.csrf !== false) headers.set('x-requested-with', 'hakit');
  return app.request(
    `/api/v1${path}`,
    { method: opts.method, headers, body: opts.json === undefined ? undefined : JSON.stringify(opts.json) },
    h.env,
    ctx,
  );
}
const events = async (res: Response) =>
  (await res.text())
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => IdeaStreamEvent.parse(JSON.parse(line.slice(5))));
const create = (json: unknown = {}, token = owner.token) =>
  call(`/projects/${pid}/ideas/generate`, { method: 'POST', json, token });
beforeAll(async () => {
  h = await createHarness();
  owner = await h.signIn(303, 'PrivateOwner');
  other = await h.signIn(304, 'PrivateTeammate');
  outsider = await h.signIn(305, 'PrivateOutsider');
  const [tpl] = await h.db
    .insert(schema.hackathonTemplates)
    .values({
      slug: 'idea-test',
      name: 'Public hackathon',
      startsAt: new Date(start),
      endsAt: new Date(end),
      timezone: 'UTC',
      tracks: [{ key: 'web', name: 'Web' }],
      judgingCriteria: [{ key: 'impact', name: 'Impact' }],
    })
    .returning();
  templateId = tpl!.id;
  const [workspace] = await h.db
    .insert(schema.workspaces)
    .values({
      name: 'Private workspace name',
      slug: 'ideas',
      createdBy: owner.id,
      startsAt: new Date(start),
      deadlineAt: new Date(end),
      hackathonTemplateId: templateId,
    })
    .returning();
  wid = workspace!.id;
  const [outside] = await h.db
    .insert(schema.workspaces)
    .values({
      name: 'Other',
      slug: 'other-ideas',
      createdBy: outsider.id,
      startsAt: new Date(start),
      deadlineAt: new Date(end),
    })
    .returning();
  otherWid = outside!.id;
  const rows = await h.db
    .insert(schema.projects)
    .values([
      { workspaceId: wid, name: 'Private project name' },
      { workspaceId: otherWid, name: 'Outside project' },
    ])
    .returning();
  pid = rows[0]!.id;
  otherPid = rows[1]!.id;
  app = createApp({ db: h.db, services: { github: h.github, llm } });
}, 30_000);
beforeEach(async () => {
  h.env.HAKIT_MOCKS = '0';
  await h.db.delete(schema.ideas);
  await h.db.delete(schema.projectConstraints);
  await h.db.delete(schema.memberProfiles);
  await h.db.delete(schema.skills);
  await h.db
    .update(schema.workspaces)
    .set({ startsAt: new Date(start), deadlineAt: new Date(end), hackathonTemplateId: templateId })
    .where(eq(schema.workspaces.id, wid));
  await h.db
    .insert(schema.memberships)
    .values([
      { workspaceId: wid, userId: owner.id, role: 'owner', colorIndex: 0 },
      { workspaceId: wid, userId: other.id, role: 'member', colorIndex: 1 },
      { workspaceId: otherWid, userId: outsider.id, role: 'owner', colorIndex: 0 },
    ])
    .onConflictDoNothing();
  const skills = await h.db
    .insert(schema.skills)
    .values([
      { slug: 'react', name: 'React', category: 'frontend', aliases: ['reactjs'] },
      { slug: 'python', name: 'Python', category: 'backend', aliases: ['py'] },
      { slug: 'typescript', name: 'TypeScript', category: 'frontend', aliases: ['ts'] },
    ])
    .returning();
  reactId = skills.find((s) => s.slug === 'react')!.id;
  pythonId = skills.find((s) => s.slug === 'python')!.id;
  await h.db.insert(schema.memberSkills).values([
    { userId: owner.id, skillId: reactId, level: 4, confidence: 0.75, source: 'inferred' },
    { userId: outsider.id, skillId: pythonId, level: 5, confidence: 1, source: 'confirmed' },
  ]);
  await h.db.insert(schema.memberProfiles).values({
    workspaceId: wid,
    userId: owner.id,
    headline: 'Private profile text',
    availability: [{ start, end, kind: 'available' }],
    availableHours: 999,
    learningGoals: ['python'],
    avoid: ['typescript'],
  });
  generate.mockReset();
  generate.mockImplementation(async (req) =>
    req.task === 'ideas.refine'
      ? candidate('Refined demo')
      : {
          ideas: Array.from({ length: (req.input as { count: number }).count }, (_, i) =>
            candidate(`React demo ${i + 1}`),
          ),
        },
  );
});
it('builds a contract-valid pseudonymized context with remaining hours instead of cached totals', async () => {
  const snapshot = await ideaContext(h.db, pid, new Date('2099-10-10T02:00:00Z'));
  expect(PlanningContext.safeParse(snapshot.context).success).toBe(true);
  expect(snapshot.context.team.members.map((m) => m.alias).sort()).toEqual(['M1', 'M2']);
  expect(snapshot.context.team.members.reduce((n, m) => n + m.availableHours, 0)).toBe(4);
  expect(snapshot.context.team.totalEffectiveHours).toBe(2.8);
  expect(snapshot.context.hackathon.hoursRemaining).toBe(4);
  expect(snapshot.levels.get('react')).toBe(3);
  expect(snapshot.levels.get('python')).toBe(0);
  const serialized = JSON.stringify(snapshot.context);
  for (const privateValue of [
    owner.id,
    other.id,
    outsider.id,
    pid,
    wid,
    'PrivateOwner',
    'Private workspace',
    'Private profile',
  ])
    expect(serialized).not.toContain(privateValue);
});
it('emits three validated ideas after they are committed, with deterministic fit and done', async () => {
  const res = await create();
  expect(res.status).toBe(200);
  const out = await events(res),
    ideas = out.filter((e) => e.type === 'idea');
  expect(ideas).toHaveLength(3);
  expect(ideas.every((e) => e.idea.teamFit === 1)).toBe(true);
  expect(out.at(-1)).toEqual({ type: 'done' });
  expect(await h.db.select().from(schema.ideas)).toHaveLength(3);
  const input = generate.mock.calls[0]![0].input as { context: unknown; count: number };
  expect(input.count).toBe(3);
  expect(JSON.stringify(input.context)).not.toContain(owner.id);
});
it('honors requested count/guidance and ignores a fabricated model fit score', async () => {
  generate.mockResolvedValueOnce({ ideas: [{ ...candidate(), teamFit: 0.01 }] });
  const out = await events(await create({ count: 1, guidance: 'Keep the demo simple' }));
  expect(out.find((e) => e.type === 'idea')).toMatchObject({ idea: { teamFit: 1 } });
  expect(generate.mock.calls[0]![0].input).toMatchObject({ guidance: 'Keep the demo simple', count: 1 });
});
it('persists human input without AI, preserving notes and marking unspecified scope', async () => {
  await h.db.delete(schema.skills);
  const res = await call(`/projects/${pid}/ideas`, {
    method: 'POST',
    token: owner.token,
    json: { title: 'My idea', pitch: 'Useful pitch', notes: 'My original notes' },
  });
  expect(res.status).toBe(200);
  const idea = Idea.parse(await res.json());
  expect(idea).toMatchObject({ source: 'user', teamFit: 0, candidate: { title: 'My idea', stack: [] } });
  expect((await h.db.select().from(schema.ideas))[0]!.payload).toMatchObject({
    userNotes: 'My original notes',
  });
  expect(generate).not.toHaveBeenCalled();
});
it('lists saved ideas with no-store and hides other projects', async () => {
  await events(await create({ count: 1 }));
  const res = await call(`/projects/${pid}/ideas`, { token: owner.token });
  expect(res.headers.get('cache-control')).toBe('no-store');
  expect(Idea.array().parse(await res.json())).toHaveLength(1);
  expect(await (await call(`/projects/${otherPid}/ideas`, { token: outsider.token })).json()).toEqual([]);
});
it('refines into a new saved idea and preserves the original', async () => {
  const first = (await events(await create({ count: 1 }))).find((e) => e.type === 'idea');
  if (first?.type !== 'idea') throw new Error('Missing idea');
  const refined = await events(
    await call(`/projects/${pid}/ideas/${first.idea.id}/refine`, {
      method: 'POST',
      token: owner.token,
      json: { instruction: 'Make it smaller' },
    }),
  );
  expect(refined.find((e) => e.type === 'idea')).toMatchObject({
    idea: { candidate: { title: 'Refined demo' } },
  });
  expect(await h.db.select().from(schema.ideas)).toHaveLength(2);
  expect(generate.mock.calls[1]![0]).toMatchObject({
    task: 'ideas.refine',
    input: { instruction: 'Make it smaller' },
  });
});
it('carries user notes into refinement without IDs or private profiles', async () => {
  const res = await call(`/projects/${pid}/ideas`, {
    method: 'POST',
    token: owner.token,
    json: { title: 'Manual', pitch: 'Pitch', notes: 'Prefer a small web app' },
  });
  const idea = Idea.parse(await res.json());
  await events(
    await call(`/projects/${pid}/ideas/${idea.id}/refine`, {
      method: 'POST',
      token: owner.token,
      json: { instruction: 'Choose a stack' },
    }),
  );
  expect(generate.mock.calls[0]![0].input).toMatchObject({
    context: { idea: { userNotes: 'Prefer a small web app' } },
  });
});
it('rejects cross-project/malformed idea IDs without calling the model', async () => {
  const [row] = await h.db
    .insert(schema.ideas)
    .values({ projectId: otherPid, title: 'Other', pitch: 'Other', payload: candidate(), source: 'user' })
    .returning();
  for (const iid of [row!.id, 'bad-id']) {
    const out = await events(
      await call(`/projects/${pid}/ideas/${iid}/refine`, {
        method: 'POST',
        token: owner.token,
        json: { instruction: 'Change it' },
      }),
    );
    expect(out.at(-1)).toMatchObject({ type: 'error', code: 'not_found' });
  }
  expect(generate).not.toHaveBeenCalled();
});
it('rejects anonymous/nonmembers and CSRF before generation', async () => {
  expect((await create({}, '')).status).toBe(401);
  expect((await create({}, outsider.token)).status).toBe(404);
  expect(
    (
      await call(`/projects/${pid}/ideas/generate`, {
        method: 'POST',
        token: owner.token,
        csrf: false,
        json: {},
      })
    ).status,
  ).toBe(403);
  expect((await create({ count: 6 })).status).toBe(400);
  expect(generate).not.toHaveBeenCalled();
});
it.each(['unknown skill', 'wrong count', 'duplicate titles', 'unselected challenge'])(
  'rejects %s atomically',
  async (kind) => {
    const data = [candidate('A'), candidate('B'), candidate('C')];
    if (kind === 'unknown skill') data[1]!.stack[0]!.skillSlugs = ['unknown'];
    if (kind === 'wrong count') data.pop();
    if (kind === 'duplicate titles') data[1]!.title = 'A';
    if (kind === 'unselected challenge')
      data[1]!.challengesAddressed = [{ challengeKey: 'wrong', how: 'Use it' }];
    generate.mockResolvedValueOnce({ ideas: data });
    const out = await events(await create());
    expect(out.at(-1)?.type).toBe('error');
    expect(out.some((e) => e.type === 'idea' || e.type === 'done')).toBe(false);
    expect(await h.db.select().from(schema.ideas)).toHaveLength(0);
  },
);
it('reports model failures safely and keeps manual submission available', async () => {
  generate.mockRejectedValueOnce(new Error('secret-key private prompt'));
  const out = await events(await create());
  expect(out.at(-1)).toMatchObject({ type: 'error', code: 'ideas_unavailable' });
  expect(JSON.stringify(out)).not.toMatch(/secret-key|private prompt/);
  expect(await h.db.select().from(schema.ideas)).toHaveLength(0);
  expect(
    (
      await call(`/projects/${pid}/ideas`, {
        method: 'POST',
        token: owner.token,
        json: { title: 'Fallback', pitch: 'My own idea' },
      })
    ).status,
  ).toBe(200);
});
it('does not save if the caller leaves while generation is running', async () => {
  generate.mockImplementationOnce(async () => {
    await h.db
      .delete(schema.memberships)
      .where(and(eq(schema.memberships.workspaceId, wid), eq(schema.memberships.userId, owner.id)));
    return { ideas: [candidate('A'), candidate('B'), candidate('C')] };
  });
  expect((await events(await create())).at(-1)).toMatchObject({ type: 'error', code: 'not_found' });
  expect(await h.db.select().from(schema.ideas)).toHaveLength(0);
});
it('excludes removed skills and profiles from other workspaces', async () => {
  await h.db
    .update(schema.memberSkills)
    .set({ source: 'removed', confidence: 0 })
    .where(eq(schema.memberSkills.userId, owner.id));
  await h.db
    .insert(schema.memberProfiles)
    .values({ workspaceId: otherWid, userId: owner.id, availability: [{ start, end, kind: 'away' }] });
  const snapshot = await ideaContext(h.db, pid, new Date(start));
  expect(snapshot.levels.get('react')).toBe(0);
  expect(snapshot.context.team.totalEffectiveHours).toBeCloseTo(4.2);
});
it('sends selected challenges and honors required/excluded technologies', async () => {
  const [challenge] = await h.db
    .insert(schema.challenges)
    .values({
      hackathonTemplateId: templateId,
      key: 'web',
      sponsor: 'Sponsor',
      title: 'Web app',
      requirements: ['Demo a web app'],
      requiredTech: ['reactjs'],
    })
    .returning();
  await h.db
    .insert(schema.projectConstraints)
    .values({ projectId: pid, kind: 'challenge', refId: challenge!.id, value: 'web' });
  generate.mockResolvedValueOnce({ ideas: [candidate()] });
  expect((await events(await create({ count: 1 }))).at(-1)?.type).toBe('error');
  const valid = {
    ...candidate(),
    challengesAddressed: [{ challengeKey: 'web', how: 'Demonstrate the working web app' }],
  };
  generate.mockResolvedValueOnce({ ideas: [valid] });
  expect((await events(await create({ count: 1 }))).at(-1)?.type).toBe('done');
  await h.db
    .insert(schema.projectConstraints)
    .values({ projectId: pid, kind: 'excluded_tech', value: 'React' });
  generate.mockResolvedValueOnce({ ideas: [valid] });
  expect((await events(await create({ count: 1 }))).at(-1)?.type).toBe('error');
});
it('fails clearly for an empty taxonomy or passed deadline before model calls', async () => {
  await h.db.delete(schema.skills);
  expect((await events(await create())).at(-1)).toMatchObject({ code: 'empty_taxonomy' });
  await h.db.insert(schema.skills).values({ slug: 'react', name: 'React', category: 'frontend' });
  await h.db
    .update(schema.workspaces)
    .set({ deadlineAt: new Date('2020-01-01') })
    .where(eq(schema.workspaces.id, wid));
  expect((await events(await create())).at(-1)).toMatchObject({ code: 'event_ended' });
  expect(generate).not.toHaveBeenCalled();
});
it('rejects oversize manual notes and overlapping availability without model calls', async () => {
  expect(
    (
      await call(`/projects/${pid}/ideas`, {
        method: 'POST',
        token: owner.token,
        json: { title: 'Title', pitch: 'Pitch', notes: 'a'.repeat(4001) },
      })
    ).status,
  ).toBe(400);
  await h.db
    .update(schema.memberProfiles)
    .set({
      availability: [
        { start, end, kind: 'available' },
        { start, end, kind: 'sleep' },
      ],
    })
    .where(eq(schema.memberProfiles.userId, owner.id));
  expect((await events(await create())).at(-1)).toMatchObject({ code: 'invalid_availability' });
  expect(generate).not.toHaveBeenCalled();
});
it('mock generation honors the requested count with distinct fixture IDs', async () => {
  h.env.HAKIT_MOCKS = '1';
  const out = await events(await create({ count: 2 }));
  const emitted = out.filter((e) => e.type === 'idea');
  expect(emitted).toHaveLength(2);
  expect(new Set(emitted.map((e) => e.idea.id)).size).toBe(2);
  expect(generate).not.toHaveBeenCalled();
});
it('rejects missing required technology and stale challenge references', async () => {
  await h.db
    .insert(schema.projectConstraints)
    .values({ projectId: pid, kind: 'required_tech', value: 'Python' });
  expect((await events(await create())).at(-1)?.type).toBe('error');
  expect(await h.db.select().from(schema.ideas)).toHaveLength(0);
  await h.db.delete(schema.projectConstraints);
  await h.db
    .insert(schema.projectConstraints)
    .values({ projectId: pid, kind: 'challenge', refId: crypto.randomUUID(), value: 'missing' });
  generate.mockClear();
  expect((await events(await create())).at(-1)).toMatchObject({ code: 'invalid_constraints' });
  expect(generate).not.toHaveBeenCalled();
});
it('counts only available time inside the event and remaining window', async () => {
  await h.db
    .update(schema.memberProfiles)
    .set({
      availability: [
        { start: '2099-10-09T23:00:00Z', end: '2099-10-10T01:00:00Z', kind: 'available' },
        { start: '2099-10-10T01:00:00Z', end: '2099-10-10T03:00:00Z', kind: 'sleep' },
        { start: '2099-10-10T03:00:00Z', end, kind: 'away' },
      ],
    })
    .where(eq(schema.memberProfiles.userId, owner.id));
  const before = await ideaContext(h.db, pid, new Date('2099-10-09T22:00:00Z'));
  expect(before.context.team.totalEffectiveHours).toBe(0.7);
  const during = await ideaContext(h.db, pid, new Date('2099-10-10T02:00:00Z'));
  expect(during.context.team.totalEffectiveHours).toBe(0);
});
