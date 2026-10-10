/** Auth, workspaces, invites, members, profiles. Owner: PL (T-201..T-203). */
import { Hono } from 'hono';
import * as fx from '@hakit/contracts/fixtures';
import type { AppEnv } from '../lib/context';
import { route } from '../lib/route';
import { mockOr } from '../lib/mock';

export const identity = new Hono<AppEnv>();

route(identity, 'me', ({ c }) =>
  mockOr(c, 'T-201', () => ({
    user: fx.members[0]!.user,
    memberships: [
      {
        workspaceId: fx.ids.workspace,
        userId: fx.ids.users.priya,
        role: 'owner' as const,
        colorIndex: 0,
        joinedAt: fx.workspace.createdAt,
        workspaceName: fx.workspace.name,
      },
    ],
  })),
);
route(identity, 'logout', ({ c }) => mockOr(c, 'T-201', () => ({ ok: true as const })));

route(identity, 'createWorkspace', ({ c, body }) =>
  mockOr(c, 'T-202', () => ({ ...fx.workspace, name: body.name })),
);
route(identity, 'getWorkspace', ({ c }) => mockOr(c, 'T-202', () => fx.workspace));
route(identity, 'updateWorkspace', ({ c, body }) =>
  mockOr(c, 'T-202', () => ({ ...fx.workspace, ...(body.name ? { name: body.name } : {}) })),
);
route(identity, 'createInvite', ({ c }) =>
  mockOr(c, 'T-202', () => ({
    id: '11000000-0000-4000-8000-000000000001',
    code: 'ORBIT7K2QX',
    url: `${c.env.APP_URL}/j/ORBIT7K2QX`,
    expiresAt: '2026-10-13T11:00:00-04:00',
    maxUses: null,
    uses: 3,
  })),
);
route(identity, 'previewInvite', ({ c }) =>
  mockOr(c, 'T-202', () => ({
    workspaceName: fx.workspace.name,
    memberAvatars: fx.members.map((m) => ({ login: m.user.githubLogin, avatarUrl: m.user.avatarUrl })),
    expired: false,
  })),
);
route(identity, 'acceptInvite', ({ c }) => mockOr(c, 'T-202', () => fx.workspace));
route(identity, 'listMembers', ({ c }) => mockOr(c, 'T-202', () => fx.members));
route(identity, 'getProfile', ({ c, params }) =>
  mockOr(c, 'T-203', () => (fx.members.find((m) => m.user.id === params.uid) ?? fx.members[0]!).profile),
);
route(identity, 'updateProfile', ({ c, params, body }) =>
  mockOr(c, 'T-203', () => ({
    ...(fx.members.find((m) => m.user.id === params.uid) ?? fx.members[0]!).profile,
    ...body,
  })),
);
