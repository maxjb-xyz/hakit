/** Repo discovery/connection, activity feed, linking, author mapping. Owner: GH (T-402..T-407). */
import { Hono } from 'hono';
import * as fx from '@hakit/contracts/fixtures';
import type { AppEnv } from '../lib/context';
import { route } from '../lib/route';
import { mockOr } from '../lib/mock';
import { fixtureRepo } from '../services/github/mock';
import { notFound } from '../lib/errors';

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
route(github, 'listActivity', ({ c }) =>
  mockOr(c, 'T-403', () => ({ items: fx.activity, nextCursor: null })),
);
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
