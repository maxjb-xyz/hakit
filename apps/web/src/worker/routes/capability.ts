/** Skills, evidence, team capability. Owner: IN (T-204..T-206). */
import { Hono } from 'hono';
import * as fx from '@hakit/contracts/fixtures';
import type { AppEnv } from '../lib/context';
import { route } from '../lib/route';
import { mockOr } from '../lib/mock';
import { unauthorized } from '../lib/errors';
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
route(capability, 'memberSkills', ({ c }) => mockOr(c, 'T-206', () => fx.priyaSkills));
route(capability, 'upsertSkill', ({ c, body }) =>
  mockOr(c, 'T-206', () => ({ ...fx.priyaSkills[0]!, level: body.level })),
);
route(capability, 'removeSkill', ({ c }) => mockOr(c, 'T-206', () => ({ ok: true as const })));
route(capability, 'searchSkills', ({ c, query }) =>
  mockOr(c, 'T-206', () =>
    fx.priyaSkills.map((s) => s.skill).filter((s) => s.slug.includes(query.q.toLowerCase())),
  ),
);
route(capability, 'teamCapability', ({ c }) => mockOr(c, 'T-206', () => fx.teamCapability));
