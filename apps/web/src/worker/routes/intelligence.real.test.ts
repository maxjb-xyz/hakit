import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  AssignmentExplanation,
  AssignmentProposal,
  Plan,
  PlanStreamEvent,
  type PlanStreamEvent as Event,
} from '@hakit/contracts';
import { planDocument } from '@hakit/contracts/fixtures';
import { schema } from '@hakit/db';
import { createHarness } from '../test/harness';
import type { LlmProvider } from '../services/ai/types';
let h: Awaited<ReturnType<typeof createHarness>>;
let owner: Awaited<ReturnType<typeof h.signIn>>, other: typeof owner, outsider: typeof owner;
let pid: string, wid: string, ideaId: string, taskId: string;
const llm: LlmProvider = {
  name: 'gemini',
  generateStructured: vi.fn(async () => {
    throw new Error('offline');
  }),
};
beforeAll(async () => {
  h = await createHarness({ llm });
  owner = await h.signIn(305);
  other = await h.signIn(309);
  outsider = await h.signIn(501);
  await h.db.insert(schema.skills).values([
    { slug: 'react', name: 'React', category: 'frontend' },
    { slug: 'python', name: 'Python', category: 'backend' },
    { slug: 'git', name: 'Git', category: 'infra_devops' },
  ]);
  const [react] = await h.db.select().from(schema.skills).where(eq(schema.skills.slug, 'react'));
  const [python] = await h.db.select().from(schema.skills).where(eq(schema.skills.slug, 'python'));
  await h.db.insert(schema.memberSkills).values([
    { userId: owner.id, skillId: react!.id, level: 4, confidence: 1, source: 'confirmed' },
    { userId: other.id, skillId: python!.id, level: 4, confidence: 1, source: 'confirmed' },
  ]);
}, 30_000);
beforeEach(async () => {
  vi.mocked(llm.generateStructured).mockReset();
  vi.mocked(llm.generateStructured).mockImplementation(async () => {
    throw new Error('offline');
  });
  const now = new Date();
  const [w] = await h.db
    .insert(schema.workspaces)
    .values({
      name: 'Intelligence',
      slug: crypto.randomUUID(),
      createdBy: owner.id,
      startsAt: now,
      deadlineAt: new Date(now.getTime() + 48 * 3_600_000),
    })
    .returning();
  wid = w!.id;
  await h.db.insert(schema.memberships).values([
    { workspaceId: wid, userId: owner.id, role: 'owner' },
    { workspaceId: wid, userId: other.id },
  ]);
  await h.db.insert(schema.memberProfiles).values([
    { workspaceId: wid, userId: owner.id, availableHours: 30 },
    { workspaceId: wid, userId: other.id, availableHours: 30 },
  ]);
  const [p] = await h.db.insert(schema.projects).values({ workspaceId: wid, name: 'Hakit' }).returning();
  pid = p!.id;
  const idea = {
    ...planDocument.idea,
    title: 'Custom idea',
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
const post = (path: string, json: unknown = {}, token = owner.token) =>
  h.call(path, { method: 'POST', json, token });
async function planEvents(id = ideaId) {
  const res = await post(`/projects/${pid}/plans/generate`, { ideaId: id });
  expect(res.status).toBe(200);
  return (await res.text())
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => PlanStreamEvent.parse(JSON.parse(line.slice(6)))) as Event[];
}
it('streams a template fallback, saves versioned drafts, and returns the saved document', async () => {
  const events = await planEvents();
  const done = events.find((e) => e.type === 'done');
  expect(done?.type).toBe('done');
  const res = await h.call(`/projects/${pid}/plans/${done!.type === 'done' ? done!.planId : ''}`, {
    token: owner.token,
  });
  expect(res.status).toBe(200);
  const saved = Plan.parse(await res.json());
  expect(saved.version).toBe(1);
  expect(saved.status).toBe('draft');
  expect(saved.model).toBe('template');
  expect(saved.payload.idea.title).toBe('Custom idea');
  expect(saved.payload.tasks.some((t) => t.title === 'Devpost submission')).toBe(true);
  await planEvents();
  const versions = await h.db
    .select({ version: schema.plans.version })
    .from(schema.plans)
    .where(eq(schema.plans.projectId, pid));
  expect(versions.map((p) => p.version).sort()).toEqual([1, 2]);
  const [idea] = await h.db.select().from(schema.ideas).where(eq(schema.ideas.id, ideaId));
  expect(idea!.selected).toBe(true);
});
it('does not save a plan for an idea in a different project and hides projects from outsiders', async () => {
  const [foreign] = await h.db
    .insert(schema.projects)
    .values({ workspaceId: wid, name: 'Foreign' })
    .returning();
  const [idea] = await h.db
    .insert(schema.ideas)
    .values({
      projectId: foreign!.id,
      title: 'Foreign',
      pitch: 'Foreign',
      payload: planDocument.idea,
      source: 'user',
    })
    .returning();
  const events = await planEvents(idea!.id);
  expect(events.some((e) => e.type === 'error' && e.code === 'not_found')).toBe(true);
  expect(await h.db.select().from(schema.plans).where(eq(schema.plans.projectId, pid))).toHaveLength(0);
  expect((await post(`/projects/${pid}/plans/generate`, { ideaId }, outsider.token)).status).toBe(404);
});
it('stores solver proposals and explanations, replaces stale proposals, and accepts the result', async () => {
  const res = await post(`/projects/${pid}/assignments/solve`);
  expect(res.status).toBe(200);
  const proposed = AssignmentProposal.parse(await res.json());
  expect(proposed.assignments).toHaveLength(1);
  expect(proposed.assignments[0]!.userId).toBe(owner.id);
  expect(proposed.assignments[0]!.status).toBe('proposed');
  expect(proposed.assignments[0]!.explanation).toContain('React');
  const explained = AssignmentExplanation.parse(
    await (await h.call(`/tasks/${taskId}/explanation`, { token: owner.token })).json(),
  );
  expect(explained.assignment.id).toBe(proposed.assignments[0]!.id);
  const next = AssignmentProposal.parse(await (await post(`/projects/${pid}/assignments/solve`)).json());
  const [old] = await h.db
    .select()
    .from(schema.assignments)
    .where(eq(schema.assignments.id, proposed.assignments[0]!.id));
  expect(old!.status).toBe('rejected');
  const accepted = await post(`/projects/${pid}/assignments/accept`, {
    assignmentIds: next.assignments.map((a) => a.id),
  });
  expect(accepted.status).toBe(200);
  const remaining = AssignmentProposal.parse(await (await post(`/projects/${pid}/assignments/solve`)).json());
  expect(remaining.assignments).toHaveLength(0);
  expect(remaining.load.find((l) => l.userId === owner.id)!.assignedHours).toBe(2);
});
it('scores manual overrides, shows the solver delta, and preserves assignments on re-solve', async () => {
  const assigned = await h.call(`/tasks/${taskId}/assignee`, {
    method: 'PUT',
    token: owner.token,
    json: { userId: other.id, lock: true },
  });
  expect(assigned.status).toBe(200);
  const row = (await assigned.json()) as { score: number; reasonCodes: string[] };
  expect(row.score).not.toBe(0);
  expect(row.reasonCodes).toContain('MANUAL');
  const explained = AssignmentExplanation.parse(
    await (await h.call(`/tasks/${taskId}/explanation`, { token: owner.token })).json(),
  );
  expect(explained.solverPick?.userId).toBe(owner.id);
  expect(explained.solverPick!.delta).toBeGreaterThan(0);
  const result = AssignmentProposal.parse(
    await (await post(`/projects/${pid}/assignments/solve`, { scope: 'all' })).json(),
  );
  expect(result.assignments).toHaveLength(0);
  const [active] = await h.db
    .select()
    .from(schema.assignments)
    .where(and(eq(schema.assignments.taskId, taskId), eq(schema.assignments.status, 'active')));
  expect(active!.userId).toBe(other.id);
});
it('rejects unqualified access to solves and explanations', async () => {
  expect((await post(`/projects/${pid}/assignments/solve`, {}, outsider.token)).status).toBe(404);
  expect((await h.call(`/tasks/${taskId}/explanation`, { token: outsider.token })).status).toBe(404);
});

it('stores a provider-generated plan and sends pseudonymized team context', async () => {
  vi.mocked(llm.generateStructured).mockImplementation(async (req) => {
    expect(JSON.stringify(req.input)).not.toContain(owner.id);
    if (req.task === 'plan.outline') return req.schema.parse(planDocument.outline);
    if (req.task === 'plan.tasks') {
      const epic = (req.input as { epic: { key: string } }).epic;
      return req.schema.parse({
        tasks: [
          {
            ...planDocument.tasks[0]!,
            key: `${epic.key}-T1`,
            epicKey: epic.key,
            estimateHours: 2,
            dependsOn: [],
            requiredSkills: [{ slug: 'react', level: 2, weight: 1 }],
          },
        ],
      });
    }
    throw new Error('unexpected repair');
  });
  const events = await planEvents();
  expect(events.some((e) => e.type === 'done')).toBe(true);
  const [saved] = await h.db.select().from(schema.plans).where(eq(schema.plans.projectId, pid));
  expect(saved!.model).toBe('gemini');
  expect(Plan.parse({ ...saved!, createdAt: saved!.createdAt.toISOString() }).payload.idea.title).toBe(
    'Custom idea',
  );
});
