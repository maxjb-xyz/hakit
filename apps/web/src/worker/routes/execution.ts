/** Mission Control snapshot + recommendations. Owners: PL (snapshot, accept), IN (rules). */
import { Hono } from 'hono';
import * as fx from '@hakit/contracts/fixtures';
import type { AppEnv } from '../lib/context';
import { route } from '../lib/route';
import { mockOr } from '../lib/mock';

export const execution = new Hono<AppEnv>();

route(execution, 'missionControl', ({ c }) =>
  mockOr(c, 'T-502', () => ({ ...fx.missionControl, generatedAt: new Date().toISOString() })),
);
route(execution, 'listRecommendations', ({ c }) => mockOr(c, 'T-504', () => [fx.stallRecommendation]));
route(execution, 'acceptRecommendation', ({ c }) =>
  mockOr(c, 'T-505', () => ({
    ...fx.board,
    tasks: fx.board.tasks.map((t) => (t.id === fx.ids.task(4) ? { ...t, assigneeId: fx.ids.users.sam } : t)),
  })),
);
route(execution, 'dismissRecommendation', ({ c }) =>
  mockOr(c, 'T-505', () => ({
    ...fx.stallRecommendation,
    status: 'dismissed' as const,
    resolvedAt: new Date().toISOString(),
    resolvedBy: fx.ids.users.priya,
  })),
);
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
