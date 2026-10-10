/** Hackathons, projects, constraints, ideas, plans. Owners: PL (projects), IN (ideas/plans). */
import { Hono } from 'hono';
import * as fx from '@hakit/contracts/fixtures';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import {
  PlanDocument,
  IdeaStreamEvent,
  Plan,
  type Feasibility,
  type HackathonTemplate,
  type PlanStreamEvent,
  type Project,
} from '@hakit/contracts';
import { schema } from '@hakit/db';
import { validatePlan } from '@hakit/engine';
import type { AppEnv } from '../lib/context';
import { route, sseRoute } from '../lib/route';
import { conflict, HttpError, notFound } from '../lib/errors';
import { loadBoard } from '../lib/board';
import { broadcast } from '../lib/broadcast';
import { planRows } from '../lib/materialize';
import { redact } from '../lib/redact';
import { assertProjectMember } from '../middleware/auth';
import * as ideas from '../services/ideas';
import { planningInput, planValidationInput } from '../services/planning/context';
import { applyPlanPatch } from '../services/planning/patch';
import { generatePlanPipeline } from '../services/planning/pipeline';

const badRequest = (message: string) => new HttpError(400, 'invalid_body', message);

export const planning = new Hono<AppEnv>();

const mockFeasibility: Feasibility = {
  ok: true,
  requiredHours: 33,
  availableEffectiveHours: 79.8,
  criticalPathHours: 13,
  hoursUntilFinalMilestone: 30,
  cutTaskKeys: [],
  issues: [],
};
const mockIdea = () => ({
  id: '12000000-0000-4000-8000-000000000001',
  projectId: fx.ids.project,
  source: 'ai' as const,
  teamFit: 0.86,
  selected: true,
  candidate: fx.planDocument.idea,
  createdAt: fx.project.createdAt,
});
const mockPlan = () => ({
  id: fx.ids.plan,
  projectId: fx.ids.project,
  version: 1,
  status: 'accepted' as const,
  payload: fx.planDocument,
  feasibility: mockFeasibility,
  model: 'mock',
  createdAt: fx.project.createdAt,
});

const toProject = (p: typeof schema.projects.$inferSelect): Project => ({
  id: p.id,
  workspaceId: p.workspaceId,
  name: p.name,
  pitch: p.pitch,
  status: p.status,
  repoId: p.repoId,
  currentPlanId: p.currentPlanId,
  createdAt: p.createdAt.toISOString(),
});

route(planning, 'getHackathon', async ({ c, params }) => {
  if (c.var.mocks) return fx.knightHacksIX;
  const db = c.var.db();
  const [t] = await db
    .select()
    .from(schema.hackathonTemplates)
    .where(eq(schema.hackathonTemplates.slug, params.slug))
    .limit(1);
  if (!t) throw notFound('Hackathon');
  const challenges = await db
    .select()
    .from(schema.challenges)
    .where(eq(schema.challenges.hackathonTemplateId, t.id))
    .orderBy(asc(schema.challenges.key));
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    startsAt: t.startsAt.toISOString(),
    endsAt: t.endsAt.toISOString(),
    timezone: t.timezone,
    tracks: t.tracks as HackathonTemplate['tracks'],
    judgingCriteria: t.judgingCriteria as HackathonTemplate['judgingCriteria'],
    challenges: challenges.map((ch) => ({
      id: ch.id,
      sponsor: ch.sponsor,
      title: ch.title,
      description: ch.description,
      requirements: ch.requirements,
      requiredTech: ch.requiredTech,
      prize: ch.prize,
      url: ch.url,
      verified: ch.verified,
    })),
    sourceUrl: t.sourceUrl,
  };
});

route(planning, 'listProjects', async ({ c, params }) => {
  if (c.var.mocks) return [fx.project];
  const rows = await c.var
    .db()
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.workspaceId, params.wid))
    .orderBy(asc(schema.projects.createdAt));
  return rows.map(toProject);
});

route(planning, 'createProject', async ({ c, params, body }) => {
  if (c.var.mocks) return { ...fx.project, name: body.name, status: 'ideating' as const };
  const [p] = await c.var
    .db()
    .insert(schema.projects)
    .values({ workspaceId: params.wid, name: body.name, pitch: body.pitch ?? null })
    .returning();
  return toProject(p!);
});

route(planning, 'getProject', async ({ c, params }) => {
  if (c.var.mocks) return fx.project;
  await assertProjectMember(c, params.pid);
  const [p] = await c.var.db().select().from(schema.projects).where(eq(schema.projects.id, params.pid));
  return toProject(p!);
});

/** Replace the project's pinned constraints. Challenge refs must belong to the workspace's hackathon template. */
route(planning, 'putConstraints', async ({ c, params, body }) => {
  if (c.var.mocks) return body;
  const { workspaceId } = await assertProjectMember(c, params.pid);
  const db = c.var.db();
  const refIds = [...new Set(body.constraints.filter((k) => k.kind === 'challenge').map((k) => k.refId))];
  if (refIds.includes(null)) throw badRequest('Challenge constraints need refId');
  if (refIds.length) {
    const valid = await db
      .select({ id: schema.challenges.id })
      .from(schema.challenges)
      .innerJoin(
        schema.workspaces,
        eq(schema.workspaces.hackathonTemplateId, schema.challenges.hackathonTemplateId),
      )
      .where(and(eq(schema.workspaces.id, workspaceId), inArray(schema.challenges.id, refIds as string[])));
    if (valid.length !== refIds.length) throw badRequest('Unknown challenge for this hackathon');
  }
  await db.transaction(async (tx) => {
    await tx.delete(schema.projectConstraints).where(eq(schema.projectConstraints.projectId, params.pid));
    if (body.constraints.length)
      await tx
        .insert(schema.projectConstraints)
        .values(body.constraints.map((k) => ({ projectId: params.pid, ...k })));
  });
  return body;
});

route(planning, 'listIdeas', ({ c, params }) => {
  if (c.var.mocks) return [mockIdea()];
  c.header('Cache-Control', 'no-store');
  return ideas.listIdeas(c.var.db(), params.pid);
});
route(planning, 'submitIdea', ({ c, params, body }) =>
  c.var.mocks
    ? { ...mockIdea(), source: 'user' as const }
    : ideas.submitIdea(c.var.db(), params.pid, c.var.user!.id, body),
);

sseRoute(planning, 'generateIdeas', async ({ c, params, body, send }) => {
  if (!c.var.mocks) {
    const emit = (event: IdeaStreamEvent) => send(IdeaStreamEvent.parse(event));
    try {
      await ideas.generateIdeas(
        c.var.db(),
        c.var.services.llm,
        params.pid,
        c.var.user!.id,
        body,
        emit,
        new Date(),
      );
    } catch (error) {
      await ideas.ideaError(emit, error);
    }
    return;
  }
  await send({ type: 'stage', message: 'Reading team capability' });
  for (let i = 0; i < body.count; i++) {
    const idea = mockIdea();
    await send({
      type: 'idea',
      idea: {
        ...idea,
        id: idea.id.replace(/[0-9a-f]{12}$/i, String(i + 1).padStart(12, '0')),
        candidate: { ...idea.candidate, title: `${idea.candidate.title} ${i + 1}` },
      },
    });
  }
  await send({ type: 'done' });
});
sseRoute(planning, 'refineIdea', async ({ c, params, body, send }) => {
  if (!c.var.mocks) {
    const emit = (event: IdeaStreamEvent) => send(IdeaStreamEvent.parse(event));
    try {
      await ideas.refineIdea(
        c.var.db(),
        c.var.services.llm,
        params.pid,
        params.iid,
        c.var.user!.id,
        body,
        emit,
        new Date(),
      );
    } catch (error) {
      await ideas.ideaError(emit, error);
    }
    return;
  }
  await send({ type: 'idea', idea: mockIdea() });
  await send({ type: 'done' });
});
sseRoute(planning, 'generatePlan', async ({ c, params, body, send }) => {
  if (!c.var.mocks) {
    await assertProjectMember(c, params.pid);
    const emit = (event: PlanStreamEvent) => send(event);
    try {
      await emit({ type: 'stage', stage: 'context', message: 'Reading team capability and selected idea' });
      const db = c.var.db();
      const input = await planningInput(db, params.pid, body.ideaId, new Date(), body.guidance);
      const result = await generatePlanPipeline(input, c.var.services.llm, emit);
      await emit({ type: 'stage', stage: 'save', message: 'Saving a versioned draft plan' });
      const saved = await db.transaction(async (tx) => {
        await tx.select().from(schema.projects).where(eq(schema.projects.id, params.pid)).for('update');
        const [latest] = await tx
          .select({ version: schema.plans.version })
          .from(schema.plans)
          .where(eq(schema.plans.projectId, params.pid))
          .orderBy(desc(schema.plans.version))
          .limit(1);
        const [plan] = await tx
          .insert(schema.plans)
          .values({
            projectId: params.pid,
            version: (latest?.version ?? 0) + 1,
            ...result,
            createdBy: c.var.user!.id,
          })
          .returning();
        await tx.update(schema.ideas).set({ selected: false }).where(eq(schema.ideas.projectId, params.pid));
        await tx.update(schema.ideas).set({ selected: true }).where(eq(schema.ideas.id, body.ideaId));
        return plan!;
      });
      c.executionCtx.waitUntil(
        broadcast(c.env, params.pid, {
          type: 'plan.progress',
          data: { planId: saved.id, stage: 'done' },
        }).catch(() => {}),
      );
      await emit({ type: 'done', planId: saved.id });
    } catch (error) {
      await emit({
        type: 'error',
        code: error instanceof HttpError ? error.code : 'PLAN_GENERATION_FAILED',
        message:
          error instanceof HttpError
            ? error.message
            : 'Plan generation failed; try again or edit a draft manually',
        fallbackAvailable: false,
      });
    }
    return;
  }
  const events: PlanStreamEvent[] = [
    { type: 'stage', stage: 'outline', message: 'Drafting scope and architecture' },
    { type: 'outline', outline: fx.planDocument.outline },
    { type: 'stage', stage: 'tasks', message: 'Breaking epics into tasks' },
    { type: 'epic_tasks', epicKey: 'E1', tasks: fx.planDocument.tasks },
    { type: 'validation', feasibility: mockFeasibility },
    { type: 'done', planId: fx.ids.plan },
  ];
  for (const e of events) await send(e);
});

route(planning, 'getPlan', async ({ c, params }) => {
  if (c.var.mocks) return mockPlan();
  await assertProjectMember(c, params.pid);
  const [plan] = await c.var
    .db()
    .select()
    .from(schema.plans)
    .where(and(eq(schema.plans.id, params.planId), eq(schema.plans.projectId, params.pid)))
    .limit(1);
  if (!plan) throw notFound('Plan');
  return Plan.parse({ ...plan, createdAt: plan.createdAt.toISOString() });
});
/**
 * T-307: apply inline edits to a draft plan. Every patch saves a new draft version (the source draft is kept, so the
 * review screen's version switcher can go back), re-validated by the engine against the current team so the
 * feasibility banner's numbers are deterministic. Accepted or superseded plans are immutable (409).
 */
route(planning, 'patchPlan', async ({ c, params, body }) => {
  if (c.var.mocks) return { ...mockPlan(), status: 'draft' as const };
  await assertProjectMember(c, params.pid);
  const db = c.var.db();
  const saved = await db.transaction(async (tx) => {
    // Lock the project so patches serialize with each other, with generation and with accept.
    await tx.select().from(schema.projects).where(eq(schema.projects.id, params.pid)).for('update');
    const [source] = await tx
      .select()
      .from(schema.plans)
      .where(and(eq(schema.plans.id, params.planId), eq(schema.plans.projectId, params.pid)))
      .limit(1);
    if (!source) throw notFound('Plan');
    if (source.status !== 'draft') throw conflict(`Plan is ${source.status}; only draft plans can be edited`);
    const [accepted] = await tx
      .select({ id: schema.plans.id })
      .from(schema.plans)
      .where(and(eq(schema.plans.projectId, params.pid), eq(schema.plans.status, 'accepted')))
      .limit(1);
    if (accepted) throw conflict('This project already has an accepted plan');

    const edited = applyPlanPatch(PlanDocument.parse(source.payload), body);
    const checked = validatePlan({
      ...(await planValidationInput(tx, params.pid, new Date())),
      outline: edited.outline,
      tasks: edited.tasks,
    });
    // Same rule as generation: persist the validator's retained scope; cut keys stay in feasibility.
    const payload = PlanDocument.safeParse({ ...edited, tasks: checked.tasks });
    if (!payload.success)
      throw new HttpError(422, 'invalid_plan', 'Edited plan is not valid', checked.feasibility.issues);
    const [latest] = await tx
      .select({ version: schema.plans.version })
      .from(schema.plans)
      .where(eq(schema.plans.projectId, params.pid))
      .orderBy(desc(schema.plans.version))
      .limit(1);
    const [plan] = await tx
      .insert(schema.plans)
      .values({
        projectId: params.pid,
        version: latest!.version + 1,
        payload: payload.data,
        feasibility: checked.feasibility,
        model: source.model,
        createdBy: c.var.user!.id,
      })
      .returning();
    return plan!;
  });
  c.executionCtx.waitUntil(
    broadcast(c.env, params.pid, {
      type: 'plan.progress',
      data: { planId: saved.id, stage: 'edited' },
    }).catch(() => {}),
  );
  return Plan.parse({ ...saved, createdAt: saved.createdAt.toISOString() });
});
/**
 * T-308: accept a draft plan and materialize it in one transaction. The project row is locked so concurrent accepts
 * serialize; a project with an accepted plan must re-plan explicitly (409), so tasks are never duplicated.
 */
route(planning, 'acceptPlan', async ({ c, params }) => {
  if (c.var.mocks) return fx.board;
  await assertProjectMember(c, params.pid);
  const db = c.var.db();
  const taskIds = await db.transaction(async (tx) => {
    const [project] = await tx
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, params.pid))
      .for('update');
    const [plan] = await tx
      .select()
      .from(schema.plans)
      .where(and(eq(schema.plans.id, params.planId), eq(schema.plans.projectId, params.pid)))
      .limit(1);
    if (!plan) throw notFound('Plan');
    if (plan.status !== 'draft') throw conflict(`Plan is already ${plan.status}`);
    const [accepted] = await tx
      .select({ id: schema.plans.id })
      .from(schema.plans)
      .where(and(eq(schema.plans.projectId, params.pid), eq(schema.plans.status, 'accepted')))
      .limit(1);
    if (accepted) throw conflict('This project already has an accepted plan');

    const doc = PlanDocument.parse(plan.payload);
    const [ws] = await tx
      .select({ startsAt: schema.workspaces.startsAt })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, project!.workspaceId));
    const rows = planRows(doc, project!.nextTaskNumber, ws?.startsAt ?? null);

    const milestoneIds = new Map<string, string>();
    for (const m of rows.milestones) {
      const [r] = await tx
        .insert(schema.milestones)
        .values({
          projectId: params.pid,
          planId: plan.id,
          title: m.title,
          ordinal: m.ordinal,
          targetAt: m.targetAt,
        })
        .returning({ id: schema.milestones.id });
      milestoneIds.set(m.key, r!.id);
    }
    const inserted = rows.tasks.length
      ? await tx
          .insert(schema.tasks)
          .values(
            rows.tasks.map(({ key: _key, milestoneKey, ...t }) => ({
              ...t,
              projectId: params.pid,
              milestoneId: milestoneKey ? (milestoneIds.get(milestoneKey) ?? null) : null,
              source: 'plan' as const,
            })),
          )
          .returning({ id: schema.tasks.id, number: schema.tasks.number })
      : [];
    const idByKey = new Map(rows.tasks.map((t) => [t.key, inserted.find((r) => r.number === t.number)!.id]));
    if (rows.dependencies.length)
      await tx.insert(schema.taskDependencies).values(
        rows.dependencies.map(([t, d]) => ({
          taskId: idByKey.get(t)!,
          dependsOnTaskId: idByKey.get(d)!,
          kind: 'blocks' as const,
        })),
      );
    await tx.update(schema.plans).set({ status: 'accepted' }).where(eq(schema.plans.id, plan.id));
    await tx
      .update(schema.plans)
      .set({ status: 'superseded' })
      .where(and(eq(schema.plans.projectId, params.pid), eq(schema.plans.status, 'draft')));
    await tx
      .update(schema.projects)
      .set({
        currentPlanId: plan.id,
        status: 'active',
        nextTaskNumber: project!.nextTaskNumber + rows.tasks.length,
      })
      .where(eq(schema.projects.id, params.pid));
    return inserted.map((r) => r.id);
  });

  // After commit: embeddings for the solver, then tell open dashboards.
  // A failed enqueue must not fail an already-committed accept; embeddings can be backfilled.
  try {
    for (let i = 0; i < taskIds.length; i += 100)
      await c.env.JOBS.send({ type: 'embed.batch', target: 'task', ids: taskIds.slice(i, i + 100) });
  } catch (e) {
    console.error(
      JSON.stringify({
        level: 'warn',
        msg: 'embed_enqueue_failed',
        requestId: c.var.requestId,
        error: redact(String(e)),
      }),
    );
  }
  c.executionCtx.waitUntil(
    broadcast(c.env, params.pid, { type: 'board.changed', data: { reason: 'plan_accepted' } }).catch(
      () => {},
    ),
  );
  return loadBoard(db, params.pid);
});
