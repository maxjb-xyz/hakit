/** Skills, evidence, team capability. Owner: IN (T-204..T-206). */
import { Hono } from 'hono';
import * as fx from '@hakit/contracts/fixtures';
import type { AppEnv } from '../lib/context';
import { route } from '../lib/route';
import { mockOr } from '../lib/mock';

export const capability = new Hono<AppEnv>();

route(capability, 'importSkills', ({ c }) => mockOr(c, 'T-204', () => ({ jobId: 'mock-import-job' })));
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
