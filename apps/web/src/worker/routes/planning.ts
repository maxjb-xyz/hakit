/** Hackathons, projects, constraints, ideas, plans. Owners: PL (projects), IN (ideas/plans). */
import { Hono } from 'hono';
import * as fx from '@hakit/contracts/fixtures';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  PlanDocument,
  IdeaStreamEvent,
  Feasibility,
  Plan,
  type PlanSummary,
  type HackathonTemplate,
  type PlanStreamEvent,
  type Project,
} from '@hakit/contracts';
import {
  chunkRows,
  columnCount,
  commit,
  isGuardFailure,
  isUniqueViolation,
  requireChanged,
  schema,
  type BatchItem,
} from '@hakit/db';
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
import { generateCachedPlan } from '../services/planning/cache';
import { planModelId } from '../services/ai';

const badRequest = (message: string) => new HttpError(400, 'invalid_body', message);

/** Next plan version, computed inside the INSERT so concurrent saves can't pick the same number. */
const nextPlanVersion = (projectId: string) =>
  sql<number>`(select coalesce(max(${schema.plans.version}), 0) + 1 from ${schema.plans} where ${schema.plans.projectId} = ${projectId})`;

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

/** Mock draft v2: more tasks than v1 and one optional task cut by the validator, so review has something to show. */
const t1 = fx.planDocument.tasks[0]!;
const mockDraftDoc: PlanDocument = {
  ...fx.planDocument,
  outline: {
    ...fx.planDocument.outline,
    epics: [
      ...fx.planDocument.outline.epics,
      { key: 'E2', title: 'Plan & assign', milestoneKey: 'M2', scopeTier: 'must', challengeKeys: ['C1'] },
    ],
  },
  tasks: [
    t1,
    {
      ...t1,
      key: 'T2',
      epicKey: 'E2',
      title: 'Plan review screen',
      description: 'Stream plan sections, feasibility banner, inline edits.',
      acceptanceCriteria: ['Edits save as one new plan version'],
      estimateHours: 4,
      requiredSkills: [{ slug: 'react', level: 3, weight: 1 }],
      dependsOn: ['T1'],
    },
    {
      ...t1,
      key: 'T3',
      epicKey: 'E2',
      title: 'Skill embeddings for matching',
      description: 'Embed tasks and member evidence with an open-weight Hub model.',
      acceptanceCriteria: ['Solver uses semantic fit'],
      estimateHours: 3,
      requiredSkills: [{ slug: 'embeddings', level: 3, weight: 1 }],
      dependsOn: [],
      priority: 'should',
    },
  ],
};
const mockDraftFeasibility: Feasibility = {
  ok: true,
  requiredHours: 74.1,
  availableEffectiveHours: 79.8,
  criticalPathHours: 9.1,
  hoursUntilFinalMilestone: 30,
  cutTaskKeys: ['T4'],
  issues: [
    {
      code: 'OVER_CAPACITY',
      severity: 'warn',
      message: 'Optional task T4 (voice briefing) moved below the cut line to fit team capacity',
      refs: ['T4'],
    },
  ],
};
const mockDraftPlan = (id: string = fx.ids.planDraft): Plan => ({
  id,
  projectId: fx.ids.project,
  version: 2,
  status: 'draft',
  payload: mockDraftDoc,
  feasibility: mockDraftFeasibility,
  model: 'mock',
  createdAt: '2026-10-10T10:30:00-04:00',
});
const summarize = (p: Plan): PlanSummary => ({
  id: p.id,
  projectId: p.projectId,
  version: p.version,
  status: p.status,
  model: p.model,
  createdAt: p.createdAt,
  taskCount: p.payload.tasks.length,
  feasibilityOk: p.feasibility.ok,
  requiredHours: p.feasibility.requiredHours,
  availableEffectiveHours: p.feasibility.availableEffectiveHours,
  cutTaskCount: p.feasibility.cutTaskKeys.length,
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

route(planning, 'getConstraints', async ({ c, params }) => {
  if (c.var.mocks) return fx.constraints;
  await assertProjectMember(c, params.pid);
  const rows = await c.var
    .db()
    .select()
    .from(schema.projectConstraints)
    .where(eq(schema.projectConstraints.projectId, params.pid));
  return {
    constraints: rows.map((k) => ({
      kind: k.kind,
      refId: k.refId,
      value: k.value,
      weight: Number(k.weight),
    })),
  };
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
  await commit(db, [
    db.delete(schema.projectConstraints).where(eq(schema.projectConstraints.projectId, params.pid)),
    ...chunkRows(
      body.constraints.map((k) => ({ projectId: params.pid, ...k })),
      columnCount(schema.projectConstraints),
    ).map((rows) => db.insert(schema.projectConstraints).values(rows)),
  ]);
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
      const result = await generateCachedPlan(input, c.var.services.llm, emit, {
        projectId: params.pid,
        model: planModelId(c.env),
        find: async (hash) => {
          const [cached] = await db
            .select()
            .from(schema.plans)
            .where(and(eq(schema.plans.projectId, params.pid), eq(schema.plans.promptHash, hash)))
            .orderBy(desc(schema.plans.version))
            .limit(1);
          return cached;
        },
      });
      await emit({ type: 'stage', stage: 'save', message: 'Saving a versioned draft plan' });
      const [inserted] = await commit(db, [
        db
          .insert(schema.plans)
          .values({
            projectId: params.pid,
            version: nextPlanVersion(params.pid),
            ...result,
            createdBy: c.var.user!.id,
          })
          .returning(),
        db.update(schema.ideas).set({ selected: false }).where(eq(schema.ideas.projectId, params.pid)),
        db.update(schema.ideas).set({ selected: true }).where(eq(schema.ideas.id, body.ideaId)),
      ]);
      const saved = (inserted as (typeof schema.plans.$inferSelect)[])[0]!;
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
    { type: 'outline', outline: mockDraftDoc.outline },
    { type: 'stage', stage: 'tasks', message: 'Breaking epics into tasks' },
    { type: 'epic_tasks', epicKey: 'E1', tasks: mockDraftDoc.tasks.filter((t) => t.epicKey === 'E1') },
    { type: 'epic_tasks', epicKey: 'E2', tasks: mockDraftDoc.tasks.filter((t) => t.epicKey === 'E2') },
    { type: 'stage', stage: 'validate', message: 'Checking capacity, skills and dependencies' },
    { type: 'validation', feasibility: mockDraftFeasibility },
    { type: 'done', planId: fx.ids.planDraft },
  ];
  for (const e of events) await send(e);
});

/** Version switcher: every plan version of the project, newest first. */
route(planning, 'listPlans', async ({ c, params }) => {
  if (c.var.mocks) return [summarize(mockDraftPlan()), summarize(mockPlan())];
  await assertProjectMember(c, params.pid);
  c.header('Cache-Control', 'no-store');
  const rows = await c.var
    .db()
    .select()
    .from(schema.plans)
    .where(eq(schema.plans.projectId, params.pid))
    .orderBy(desc(schema.plans.version));
  return rows.map((p) => {
    // Older rows may predate validation (feasibility `{}`); summarize them as unchecked rather than failing.
    const f = Feasibility.safeParse(p.feasibility);
    const doc = PlanDocument.safeParse(p.payload);
    return {
      id: p.id,
      projectId: p.projectId,
      version: p.version,
      status: p.status,
      model: p.model,
      createdAt: p.createdAt.toISOString(),
      taskCount: doc.success ? doc.data.tasks.length : 0,
      feasibilityOk: f.success && f.data.ok,
      requiredHours: f.success ? f.data.requiredHours : 0,
      availableEffectiveHours: f.success ? f.data.availableEffectiveHours : 0,
      cutTaskCount: f.success ? f.data.cutTaskKeys.length : 0,
    };
  });
});

route(planning, 'getPlan', async ({ c, params }) => {
  if (c.var.mocks) return params.planId === fx.ids.plan ? mockPlan() : mockDraftPlan(params.planId);
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
  if (c.var.mocks) {
    // Stateless mock: apply the edits to the demo draft so the review screen shows them saved as v3.
    const base = params.planId === fx.ids.plan ? mockPlan() : mockDraftPlan();
    return {
      ...base,
      id: params.planId,
      version: 3,
      status: 'draft' as const,
      payload: applyPlanPatch(base.payload, body),
    };
  }
  await assertProjectMember(c, params.pid);
  const db = c.var.db();
  const [source] = await db
    .select()
    .from(schema.plans)
    .where(and(eq(schema.plans.id, params.planId), eq(schema.plans.projectId, params.pid)))
    .limit(1);
  if (!source) throw notFound('Plan');
  if (source.status !== 'draft') throw conflict(`Plan is ${source.status}; only draft plans can be edited`);
  const [accepted] = await db
    .select({ id: schema.plans.id })
    .from(schema.plans)
    .where(and(eq(schema.plans.projectId, params.pid), eq(schema.plans.status, 'accepted')))
    .limit(1);
  if (accepted) throw conflict('This project already has an accepted plan');

  const edited = applyPlanPatch(PlanDocument.parse(source.payload), body);
  const checked = validatePlan({
    ...(await planValidationInput(db, params.pid, new Date())),
    outline: edited.outline,
    tasks: edited.tasks,
  });
  // Same rule as generation: persist the validator's retained scope; cut keys stay in feasibility.
  const payload = PlanDocument.safeParse({ ...edited, tasks: checked.tasks });
  if (!payload.success)
    throw new HttpError(422, 'invalid_plan', 'Edited plan is not valid', checked.feasibility.issues);
  // Guard: the source must still be a draft and the project still without an accepted plan, so a patch never
  // lands after an accept. The no-op update matches only if both hold; requireChanged rolls back otherwise.
  let saved: typeof schema.plans.$inferSelect;
  try {
    const results = await commit(db, [
      db
        .update(schema.plans)
        .set({ status: 'draft' })
        .where(
          and(
            eq(schema.plans.id, source.id),
            eq(schema.plans.status, 'draft'),
            sql`not exists (select 1 from ${schema.plans} p where p.project_id = ${params.pid} and p.status = 'accepted')`,
          ),
        ),
      requireChanged(db),
      db
        .insert(schema.plans)
        .values({
          projectId: params.pid,
          version: nextPlanVersion(params.pid),
          payload: payload.data,
          feasibility: checked.feasibility,
          model: source.model,
          createdBy: c.var.user!.id,
        })
        .returning(),
    ]);
    saved = (results[2] as (typeof schema.plans.$inferSelect)[])[0]!;
  } catch (e) {
    if (isGuardFailure(e)) throw conflict('Plan changed while saving; reload and try again');
    throw e;
  }
  c.executionCtx.waitUntil(
    broadcast(c.env, params.pid, {
      type: 'plan.progress',
      data: { planId: saved.id, stage: 'edited' },
    }).catch(() => {}),
  );
  return Plan.parse({ ...saved, createdAt: saved.createdAt.toISOString() });
});
/**
 * T-308: accept a draft plan and materialize it in one atomic batch. Compare-and-set guards on the plan's status
 * and the project's task counter fail the batch if another accept, patch or task creation landed since the reads,
 * so concurrent accepts can't both succeed; a project with an accepted plan must re-plan explicitly (409), so
 * tasks are never duplicated.
 */
route(planning, 'acceptPlan', async ({ c, params }) => {
  if (c.var.mocks) return fx.board;
  await assertProjectMember(c, params.pid);
  const db = c.var.db();
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, params.pid));
  const [plan] = await db
    .select()
    .from(schema.plans)
    .where(and(eq(schema.plans.id, params.planId), eq(schema.plans.projectId, params.pid)))
    .limit(1);
  if (!plan) throw notFound('Plan');
  if (plan.status !== 'draft') throw conflict(`Plan is already ${plan.status}`);
  const [accepted] = await db
    .select({ id: schema.plans.id })
    .from(schema.plans)
    .where(and(eq(schema.plans.projectId, params.pid), eq(schema.plans.status, 'accepted')))
    .limit(1);
  if (accepted) throw conflict('This project already has an accepted plan');

  const doc = PlanDocument.parse(plan.payload);
  const [ws] = await db
    .select({ startsAt: schema.workspaces.startsAt })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, project!.workspaceId));
  const firstNumber = project!.nextTaskNumber;
  const rows = planRows(doc, firstNumber, ws?.startsAt ?? null);

  const milestoneIds = new Map(rows.milestones.map((m) => [m.key, crypto.randomUUID()]));
  const idByKey = new Map(rows.tasks.map((t) => [t.key, crypto.randomUUID()]));
  const milestoneRows = rows.milestones.map((m) => ({
    id: milestoneIds.get(m.key)!,
    projectId: params.pid,
    planId: plan.id,
    title: m.title,
    ordinal: m.ordinal,
    targetAt: m.targetAt,
  }));
  const taskRows = rows.tasks.map(({ key, milestoneKey, ...t }) => ({
    ...t,
    id: idByKey.get(key)!,
    projectId: params.pid,
    milestoneId: milestoneKey ? (milestoneIds.get(milestoneKey) ?? null) : null,
    source: 'plan' as const,
  }));
  const depRows = rows.dependencies.map(([t, d]) => ({
    taskId: idByKey.get(t)!,
    dependsOnTaskId: idByKey.get(d)!,
    kind: 'blocks' as const,
  }));
  const writes: BatchItem[] = [
    // Guard: only a plan still in draft becomes accepted (another accept supersedes every other draft).
    db
      .update(schema.plans)
      .set({ status: 'accepted' })
      .where(and(eq(schema.plans.id, plan.id), eq(schema.plans.status, 'draft'))),
    requireChanged(db),
    db
      .update(schema.plans)
      .set({ status: 'superseded' })
      .where(and(eq(schema.plans.projectId, params.pid), eq(schema.plans.status, 'draft'))),
    // Guard: task numbers were taken from this counter value; a concurrent task create moved it.
    db
      .update(schema.projects)
      .set({
        currentPlanId: plan.id,
        status: 'active',
        nextTaskNumber: firstNumber + rows.tasks.length,
      })
      .where(and(eq(schema.projects.id, params.pid), eq(schema.projects.nextTaskNumber, firstNumber))),
    requireChanged(db),
    ...chunkRows(milestoneRows, columnCount(schema.milestones)).map((r) =>
      db.insert(schema.milestones).values(r),
    ),
    ...chunkRows(taskRows, columnCount(schema.tasks)).map((r) => db.insert(schema.tasks).values(r)),
    ...chunkRows(depRows, columnCount(schema.taskDependencies)).map((r) =>
      db.insert(schema.taskDependencies).values(r),
    ),
  ];
  try {
    await commit(db, writes);
  } catch (e) {
    if (isGuardFailure(e) || isUniqueViolation(e))
      throw conflict('The plan or board changed while accepting; reload and try again');
    throw e;
  }
  const taskIds = taskRows.map((t) => t.id);

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
