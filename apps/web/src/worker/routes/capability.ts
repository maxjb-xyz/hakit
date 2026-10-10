/** Skills, evidence, team capability. Owner: IN (T-204..T-206). */
import { Hono, type Context } from 'hono';
import * as fx from '@hakit/contracts/fixtures';
import type { AppEnv } from '../lib/context';
import { route } from '../lib/route';
import { schema } from '@hakit/db';
import { and, eq } from 'drizzle-orm';
import { Id } from '@hakit/contracts';
import { editSkill, memberSkills, searchTaxonomy, teamCapability } from '../services/capability';
import { HttpError, notFound, unauthorized } from '../lib/errors';
import { JobMessage } from '@hakit/contracts';

export const capability = new Hono<AppEnv>();

route(capability, 'importSkills', async ({ c, params }) => {
  if (c.var.mocks) return { jobId: 'mock-import-job' };
  if (!c.var.user) throw unauthorized();
  const jobId = crypto.randomUUID();
  await c.env.JOBS.send(
    JobMessage.parse({ type: 'skills.import', userId: c.var.user.id, workspaceId: params.wid }),
  );
  return { jobId };
});
route(capability, 'memberSkills', async ({ c, params }) => {
  if (c.var.mocks) return fx.memberSkillsByUser[params.uid] ?? [];
  if (!Id.safeParse(params.uid).success) throw notFound('Member');
  const db = c.var.db();
  const [member] = await db
    .select()
    .from(schema.memberships)
    .where(and(eq(schema.memberships.workspaceId, params.wid), eq(schema.memberships.userId, params.uid)))
    .limit(1);
  if (!member) throw notFound('Member');
  c.header('Cache-Control', 'no-store');
  return memberSkills(db, params.uid);
});
async function refreshEmbeddings(c: Context<AppEnv>, userId: string) {
  try {
    await c.env.JOBS.send(JobMessage.parse({ type: 'embed.batch', target: 'member', ids: [userId] }));
  } catch {
    throw new HttpError(
      503,
      'embedding_refresh_pending',
      'Skill change was saved, but embedding refresh could not be queued. Retry this request.',
    );
  }
}
route(capability, 'upsertSkill', async ({ c, params, body }) => {
  if (c.var.mocks) return { ...fx.priyaSkills[0]!, level: body.level };
  if (!c.var.user) throw unauthorized();
  const result = await editSkill(c.var.db(), c.var.user.id, params.slug, body);
  await refreshEmbeddings(c, c.var.user.id);
  if (!result) throw notFound('Skill');
  return result;
});
route(capability, 'removeSkill', async ({ c, params }) => {
  if (c.var.mocks) return { ok: true as const };
  if (!c.var.user) throw unauthorized();
  await editSkill(c.var.db(), c.var.user.id, params.slug, null);
  await refreshEmbeddings(c, c.var.user.id);
  return { ok: true as const };
});
route(capability, 'searchSkills', async ({ c, query }) =>
  c.var.mocks
    ? fx.priyaSkills.map((s) => s.skill).filter((s) => s.slug.includes(query.q.toLowerCase()))
    : searchTaxonomy(c.var.db(), query.q, c.var.services.embeddings),
);
route(capability, 'teamCapability', async ({ c, params }) => {
  if (c.var.mocks) return fx.teamCapability;
  c.header('Cache-Control', 'no-store');
  return teamCapability(c.var.db(), params.wid);
});
