/** Mission Control snapshot + recommendations. Owners: PL (snapshot, accept), IN (rules). */
import { Hono, type Context } from 'hono';
import { eq } from 'drizzle-orm';
import { Id, type RecommendationAction } from '@hakit/contracts';
import { schema, type Db } from '@hakit/db';
import * as fx from '@hakit/contracts/fixtures';
import type { AppEnv } from '../lib/context';
import { route } from '../lib/route';
import { mockOr } from '../lib/mock';
import { conflict, notFound } from '../lib/errors';
import { loadBoard } from '../lib/board';
import { broadcast } from '../lib/broadcast';
import { buildSnapshot, toRecommendation } from '../lib/mission-control';
import { applyActions, mergeActions } from '../lib/apply-recommendation';
import { assertProjectMember } from '../middleware/auth';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

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

/** Inside the transaction: lock the row; 409 once resolved (concurrent accept/dismiss serialize here). */
async function lockOpen(tx: Tx, rid: string) {
  const [r] = await tx
    .select()
    .from(schema.recommendations)
    .where(eq(schema.recommendations.id, rid))
    .for('update');
  if (r!.status !== 'open') throw conflict(`Recommendation is already ${r!.status}`);
  return r!;
}

const resolvedBroadcasts = (
  c: Context<AppEnv>,
  r: typeof schema.recommendations.$inferSelect,
  boardChanged: boolean,
) =>
  c.executionCtx.waitUntil(
    (async () => {
      await broadcast(c.env, r.projectId, {
        type: 'recommendation.resolved',
        data: { recommendation: toRecommendation(r) },
      });
      if (boardChanged) {
        await broadcast(c.env, r.projectId, {
          type: 'board.changed',
          data: { reason: 'recommendation_accepted' },
        });
        await c.env.JOBS.send({ type: 'recs.evaluate', projectId: r.projectId, reason: 'board_change' });
      }
    })().catch(() => {}),
  );
route(execution, 'listRecommendations', ({ c }) => mockOr(c, 'T-504', () => [fx.stallRecommendation]));
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
  const resolved = await db.transaction(async (tx) => {
    const r = await lockOpen(tx, params.rid);
    const actions = mergeActions(r.actions as RecommendationAction[], body.modifications);
    await applyActions(tx, { projectId: r.projectId, workspaceId, actorId: c.var.user!.id, now }, actions);
    const [done] = await tx
      .update(schema.recommendations)
      .set({ status: 'accepted', actions, resolvedAt: now, resolvedBy: c.var.user!.id })
      .where(eq(schema.recommendations.id, r.id))
      .returning();
    return done!;
  });
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
  const resolved = await c.var.db().transaction(async (tx) => {
    const r = await lockOpen(tx, params.rid);
    const [done] = await tx
      .update(schema.recommendations)
      .set({
        status: 'dismissed',
        resolvedAt: new Date(),
        resolvedBy: c.var.user!.id,
        dismissReason: body.reason ?? null,
      })
      .where(eq(schema.recommendations.id, r.id))
      .returning();
    return done!;
  });
  resolvedBroadcasts(c, resolved, false);
  return toRecommendation(resolved);
});
route(execution, 'aiStatus', ({ c }) =>
  mockOr(c, 'T-301', () => [
    { provider: 'template' as const, role: 'plan' as const, model: 'mock', healthy: true, lastErrorAt: null },
    {
      provider: 'template' as const,
      role: 'embeddings' as const,
      model: 'mock-hash',
      healthy: true,
      lastErrorAt: null,
    },
  ]),
);
