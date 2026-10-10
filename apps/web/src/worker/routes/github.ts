/** Repo discovery/connection, activity feed, linking, author mapping. Owner: GH (T-402..T-407). */
import { Hono } from 'hono';
import { ActivityEvent } from '@hakit/contracts';
import { schema } from '@hakit/db';
import { desc, eq } from 'drizzle-orm';
import * as fx from '@hakit/contracts/fixtures';
import type { AppEnv } from '../lib/context';
import { route } from '../lib/route';
import { mockOr } from '../lib/mock';
import { fixtureRepo } from '../services/github/mock';
import { notFound, unauthorized } from '../lib/errors';
import { githubUserToken } from '../lib/github-token';
import { installationUrl } from '../services/github/setup';
import { connectRepository, requireProjectMember } from '../services/github/connections';

export const github = new Hono<AppEnv>();

route(github, 'installUrl', ({ c, query }) =>
  c.var.mocks
    ? { url: c.var.services.github.installUrl('mock-state') }
    : installationUrl(c, query.workspaceId),
);
route(github, 'listRepos', async ({ c }) => {
  if (c.var.mocks) return [fixtureRepo];
  if (!c.var.user) throw unauthorized();
  c.header('Cache-Control', 'no-store');
  const token = await githubUserToken(c.var.db(), c.var.user.id, c.env.TOKEN_ENC_KEY);
  return c.var.services.github.listInstallationRepos(token);
});
route(github, 'createRepo', ({ c, body }) =>
  mockOr(c, 'T-407', () => ({
    mode: 'guided' as const,
    url: `https://github.com/new?name=${encodeURIComponent(body.name)}`,
  })),
);
route(github, 'connectRepo', async ({ c, params, body }) => {
  if (c.var.mocks) return fixtureRepo;
  if (!c.var.user) throw unauthorized();
  const db = c.var.db();
  await requireProjectMember(db, c.var.user.id, params.pid);
  const token = await githubUserToken(db, c.var.user.id, c.env.TOKEN_ENC_KEY);
  const repo = (await c.var.services.github.listInstallationRepos(token)).find((r) => r.id === body.repoId);
  if (!repo) throw notFound('Repository');
  const installation = (await c.var.services.github.listInstallations(token)).find(
    (i) => i.id === repo.installationId && i.suspended_at === null,
  );
  if (!installation) throw notFound('Installation');
  await connectRepository(db, c.env, params.pid, c.var.user.id, repo, installation);
  return repo;
});
route(github, 'listActivity', async ({ c, params }) => {
  if (c.var.mocks) return { items: fx.activity, nextCursor: null };
  if (!c.var.user) throw unauthorized();
  const db = c.var.db();
  await requireProjectMember(db, c.var.user.id, params.pid);
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
