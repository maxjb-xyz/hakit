/** Repo discovery/connection, activity feed, linking, author mapping. Owner: GH (T-402..T-407). */
import { Hono } from 'hono';
import { ActivityEvent, WsPayload } from '@hakit/contracts';
import { schema } from '@hakit/db';
import { and, desc, eq } from 'drizzle-orm';
import * as fx from '@hakit/contracts/fixtures';
import type { AppEnv } from '../lib/context';
import { route } from '../lib/route';
import { broadcast } from '../lib/broadcast';
import { fixtureRepo } from '../services/github/mock';
import { notFound, unauthorized } from '../lib/errors';
import { githubUserToken } from '../lib/github-token';
import { guidedRepoUrl, installationUrl } from '../services/github/setup';
import { mapAuthorAlias, setManualLink } from '../services/github/linking';
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
  const token = await githubUserToken(c.var.db(), c.var.user.id, c.env.TOKEN_ENC_KEY, c.var.services.github);
  return c.var.services.github.listInstallationRepos(token);
});
route(github, 'createRepo', ({ c, body }) => {
  // Guided creation (INTEGRATIONS §1.6 A); API creation is T-409 behind an opt-in permission upgrade.
  if (!c.var.mocks && !c.var.user) throw unauthorized();
  return { mode: 'guided' as const, url: guidedRepoUrl(body) };
});
route(github, 'connectRepo', async ({ c, params, body }) => {
  if (c.var.mocks) return fixtureRepo;
  if (!c.var.user) throw unauthorized();
  const db = c.var.db();
  await requireProjectMember(db, c.var.user.id, params.pid);
  const token = await githubUserToken(db, c.var.user.id, c.env.TOKEN_ENC_KEY, c.var.services.github);
  const repo = (await c.var.services.github.listInstallationRepos(token)).find((r) => r.id === body.repoId);
  if (!repo) throw notFound('Repository');
  const installation = (await c.var.services.github.listInstallations(token)).find(
    (i) => i.id === repo.installationId && i.suspended_at === null,
  );
  if (!installation) throw notFound('Installation');
  await connectRepository(db, c.env, params.pid, c.var.user.id, repo, installation);
  return repo;
});
route(github, 'listActivity', async ({ c, params, query }) => {
  if (c.var.mocks)
    return {
      items: fx.activityFeed.filter((a) => !query.source || a.source === query.source),
      nextCursor: null,
    };
  if (!c.var.user) throw unauthorized();
  const db = c.var.db();
  await requireProjectMember(db, c.var.user.id, params.pid);
  // The current endpoint contract has no pagination query; return the latest 100 events.
  const rows = await db
    .select()
    .from(schema.activityEvents)
    .where(
      and(
        eq(schema.activityEvents.projectId, params.pid),
        query.source ? eq(schema.activityEvents.source, query.source) : undefined,
      ),
    )
    .orderBy(desc(schema.activityEvents.ts), desc(schema.activityEvents.id))
    .limit(100);
  return {
    items: rows.map((row) => ActivityEvent.parse({ ...row, ts: row.ts.toISOString() })),
    nextCursor: null,
  };
});
route(github, 'linkActivity', async ({ c, params, body }) => {
  if (c.var.mocks) {
    const e = fx.activity.find((a) => a.id === params.eid);
    if (!e) throw notFound('Activity');
    return {
      ...e,
      taskId: body.taskId,
      linkKind: body.taskId ? ('confirmed' as const) : ('none' as const),
      linkConfidence: null,
    };
  }
  if (!c.var.user) throw unauthorized();
  // The route guard has checked membership of the event's project; the task must be in that project too.
  const event = await setManualLink(c.var.db(), params.eid, body.taskId);
  await broadcast(c.env, event.projectId, WsPayload.parse({ type: 'activity.created', data: { event } }));
  return event;
});
route(github, 'mapAuthor', async ({ c, params, body }) => {
  if (c.var.mocks) return { ok: true as const };
  if (!c.var.user) throw unauthorized();
  // requireMember has checked the caller's workspace membership; the target member is checked before the batch.
  const relinked = await mapAuthorAlias(c.var.db(), params.wid, body.raw, body.userId);
  // One notification per project invalidates its activity feed; clients may see a known event ID again.
  for (const event of relinked)
    await broadcast(c.env, event.projectId, WsPayload.parse({ type: 'activity.created', data: { event } }));
  return { ok: true as const };
});
