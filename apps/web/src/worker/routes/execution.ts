/** Mission Control snapshot + recommendations. Owners: PL (snapshot, accept), IN (rules). */
import { Hono, type Context } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { Id, type RecommendationAction } from '@hakit/contracts';
import { commit, isGuardFailure, requireChanged, schema } from '@hakit/db';
import * as fx from '@hakit/contracts/fixtures';
import type { AppEnv } from '../lib/context';
import { route } from '../lib/route';
import { conflict, notFound } from '../lib/errors';
import { loadBoard } from '../lib/board';
import { broadcast } from '../lib/broadcast';
import { buildSnapshot, toRecommendation } from '../lib/mission-control';
import { applyActions, mergeActions } from '../lib/apply-recommendation';
import { assertProjectMember } from '../middleware/auth';
import { aiProviderStatus } from '../services/ai/status';

export const execution = new Hono<AppEnv>();

route(execution, 'missionControl', async ({ c, params }) => {
  if (c.var.mocks) return { ...fx.missionControl, generatedAt: new Date().toISOString() };
  await assertProjectMember(c, params.pid);
  return buildSnapshot(c.var.db(), params.pid, new Date());
});

/** Access check (outside any transaction): 404 unless the caller is a member of the recommendation's project. */
async function assertRecommendationMember(c: Context<AppEnv>, rid: string) {
  if (!Id.safeParse(rid).success) throw notFound('Recommendation');
  const [r] = await c.var
    .db()
    .select({ projectId: schema.recommendations.projectId })
    .from(schema.recommendations)
    .where(eq(schema.recommendations.id, rid));
  if (!r) throw notFound('Recommendation');
  return { projectId: r.projectId, ...(await assertProjectMember(c, r.projectId)) };
}

/** 409 once resolved. The resolving batch re-checks `status = 'open'`, so concurrent accept/dismiss can't both win. */
async function readOpen(c: Context<AppEnv>, rid: string) {
  const [r] = await c.var
    .db()
    .select()
    .from(schema.recommendations)
    .where(eq(schema.recommendations.id, rid));
  if (r!.status !== 'open') throw conflict(`Recommendation is already ${r!.status}`);
  return r!;
}

/** The status change that resolves `rid`, guarded so the batch rolls back if someone resolved it first. */
const resolveOpen = (
  db: ReturnType<AppEnv['Variables']['db']>,
  rid: string,
  set: Partial<typeof schema.recommendations.$inferInsert>,
) => [
  db
    .update(schema.recommendations)
    .set(set)
    .where(and(eq(schema.recommendations.id, rid), eq(schema.recommendations.status, 'open'))),
  requireChanged(db),
];

const alreadyResolved = (e: unknown) => {
  throw isGuardFailure(e) ? conflict('Recommendation was resolved by someone else') : e;
};

const resolvedBroadcasts = (
  c: Context<AppEnv>,
  r: typeof schema.recommendations.$inferSelect,
  boardChanged: boolean,
) =>
  c.executionCtx.waitUntil(
    Promise.allSettled([
      broadcast(c.env, r.projectId, {
        type: 'recommendation.resolved',
        data: { recommendation: toRecommendation(r) },
      }),
      ...(boardChanged
        ? [
            broadcast(c.env, r.projectId, {
              type: 'board.changed',
              data: { reason: 'recommendation_accepted' },
            }),
            c.env.JOBS.send({ type: 'recs.evaluate', projectId: r.projectId, reason: 'board_change' }),
          ]
        : []),
    ]),
  );
/** Open recommendations, newest first. Resolved ones reach clients via `recommendation.resolved`. */
route(execution, 'listRecommendations', async ({ c, params }) => {
  if (c.var.mocks) return fx.recommendations;
  await assertProjectMember(c, params.pid);
  const rows = await c.var
    .db()
    .select()
    .from(schema.recommendations)
    .where(and(eq(schema.recommendations.projectId, params.pid), eq(schema.recommendations.status, 'open')))
    .orderBy(desc(schema.recommendations.createdAt), desc(schema.recommendations.id));
  return rows.map(toRecommendation);
});
route(execution, 'acceptRecommendation', async ({ c, params, body }) => {
  if (c.var.mocks)
    return {
      ...fx.board,
      tasks: fx.board.tasks.map((t) =>
        t.id === fx.ids.task(4) ? { ...t, assigneeId: fx.ids.users.sam } : t,
      ),
    };
  const { workspaceId } = await assertRecommendationMember(c, params.rid);
  const db = c.var.db();
  const now = new Date();
  const r = await readOpen(c, params.rid);
  const actions = mergeActions(r.actions as RecommendationAction[], body.modifications);
  const writes = await applyActions(
    db,
    { projectId: r.projectId, workspaceId, actorId: c.var.user!.id, now },
    actions,
  );
  const set = { status: 'accepted' as const, actions, resolvedAt: now, resolvedBy: c.var.user!.id };
  await commit(db, [...resolveOpen(db, r.id, set), ...writes]).catch(alreadyResolved);
  const resolved = { ...r, ...set };
  resolvedBroadcasts(c, resolved, true);
  return loadBoard(db, resolved.projectId);
});

route(execution, 'dismissRecommendation', async ({ c, params, body }) => {
  if (c.var.mocks)
    return {
      ...fx.stallRecommendation,
      status: 'dismissed' as const,
      resolvedAt: new Date().toISOString(),
      resolvedBy: fx.ids.users.priya,
    };
  await assertRecommendationMember(c, params.rid);
  const db = c.var.db();
  const r = await readOpen(c, params.rid);
  const set = {
    status: 'dismissed' as const,
    resolvedAt: new Date(),
    resolvedBy: c.var.user!.id,
    dismissReason: body.reason ?? null,
  };
  await commit(db, resolveOpen(db, r.id, set)).catch(alreadyResolved);
  const resolved = { ...r, ...set };
  resolvedBroadcasts(c, resolved, false);
  return toRecommendation(resolved);
});
route(execution, 'aiStatus', ({ c }) => {
  if (c.var.mocks)
    return [
      {
        provider: 'template' as const,
        role: 'plan' as const,
        model: 'mock',
        healthy: true,
        lastErrorAt: null,
      },
      {
        provider: 'template' as const,
        role: 'embeddings' as const,
        model: 'mock-hash',
        healthy: true,
        lastErrorAt: null,
      },
    ];
  return aiProviderStatus(c.env, c.var.services);
});
