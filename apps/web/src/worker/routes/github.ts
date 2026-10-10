/** Repo discovery/connection, activity feed, linking, author mapping. Owner: GH (T-402..T-407). */
import { Hono } from 'hono';
import { ActivityEvent, Id } from '@hakit/contracts';
import { schema } from '@hakit/db';
import { and, desc, eq } from 'drizzle-orm';
import * as fx from '@hakit/contracts/fixtures';
import type { AppEnv } from '../lib/context';
import { route } from '../lib/route';
import { mockOr } from '../lib/mock';
import { fixtureRepo } from '../services/github/mock';
import { notFound, unauthorized } from '../lib/errors';

export const github = new Hono<AppEnv>();

route(github, 'installUrl', ({ c }) =>
  mockOr(c, 'T-402', () => ({ url: c.var.services.github.installUrl('mock-state') })),
);
route(github, 'listRepos', ({ c }) => mockOr(c, 'T-402', () => [fixtureRepo]));
route(github, 'createRepo', ({ c, body }) =>
  mockOr(c, 'T-407', () => ({
    mode: 'guided' as const,
    url: `https://github.com/new?name=${encodeURIComponent(body.name)}`,
  })),
);
route(github, 'connectRepo', ({ c }) => mockOr(c, 'T-402', () => fixtureRepo));
route(github, 'listActivity', async ({ c, params }) => {
  if (c.var.mocks) return { items: fx.activity, nextCursor: null };
  if (!c.var.user) throw unauthorized();
  if (!Id.safeParse(params.pid).success) throw notFound('Project');
  const db = c.var.db();
  const [member] = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .innerJoin(
      schema.memberships,
      and(
        eq(schema.memberships.workspaceId, schema.projects.workspaceId),
        eq(schema.memberships.userId, c.var.user.id),
      ),
    )
    .where(eq(schema.projects.id, params.pid))
    .limit(1);
  if (!member) throw notFound('Project');
  // The current endpoint contract has no pagination query; return the latest 100 events.
  const rows = await db
    .select()
    .from(schema.activityEvents)
    .where(eq(schema.activityEvents.projectId, params.pid))
    .orderBy(desc(schema.activityEvents.ts), desc(schema.activityEvents.id))
    .limit(100);
  return {
    items: rows.map((row) => ActivityEvent.parse({ ...row, ts: row.ts.toISOString() })),
    nextCursor: null,
  };
});
route(github, 'linkActivity', ({ c, params, body }) =>
  mockOr(c, 'T-406', () => {
    const e = fx.activity.find((a) => a.id === params.eid);
    if (!e) throw notFound('Activity');
    return {
      ...e,
      taskId: body.taskId,
      linkKind: body.taskId ? ('confirmed' as const) : ('none' as const),
      linkConfidence: null,
    };
  }),
);
route(github, 'mapAuthor', ({ c }) => mockOr(c, 'T-407', () => ({ ok: true as const })));
