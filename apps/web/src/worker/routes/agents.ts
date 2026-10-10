/** Agent tokens + sessions (UI side). Ingestion endpoint lives in ./agent-ingest.ts. Owner: GH (T-601..T-604). */
import { Hono } from 'hono';
import * as fx from '@hakit/contracts/fixtures';
import type { AppEnv } from '../lib/context';
import { route } from '../lib/route';
import { mockOr } from '../lib/mock';

export const agents = new Hono<AppEnv>();

route(agents, 'createAgentToken', ({ c }) =>
  mockOr(c, 'T-601', () => ({
    id: '13000000-0000-4000-8000-000000000001',
    token: 'hk_at_mock_token_do_not_use',
    installCommand: '/plugin marketplace add <org>/hakit-plugins && /plugin install hakit',
  })),
);
route(agents, 'listAgentTokens', ({ c }) => mockOr(c, 'T-601', () => []));
route(agents, 'revokeAgentToken', ({ c }) => mockOr(c, 'T-601', () => ({ ok: true as const })));
route(agents, 'listAgentSessions', ({ c }) => mockOr(c, 'T-602', () => fx.agentSessions));
route(agents, 'linkAgentSession', ({ c, body }) =>
  mockOr(c, 'T-602', () => ({
    ...fx.agentSessions[0]!,
    taskId: body.taskId,
    linkKind: body.taskId ? ('confirmed' as const) : ('none' as const),
  })),
);
