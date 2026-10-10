/** Hackathons, projects, constraints, ideas, plans. Owners: PL (projects), IN (ideas/plans). */
import { Hono } from 'hono';
import * as fx from '@hakit/contracts/fixtures';
import type { Feasibility, PlanStreamEvent } from '@hakit/contracts';
import type { AppEnv } from '../lib/context';
import { route, sseRoute } from '../lib/route';
import { mockOr } from '../lib/mock';
import { notImplemented } from '../lib/errors';

export const planning = new Hono<AppEnv>();

const mockFeasibility: Feasibility = {
  ok: true,
  requiredHours: 33,
  availableEffectiveHours: 79.8,
  criticalPathHours: 13,
  hoursUntilFinalMilestone: 30,
  cutTaskKeys: [],
  issues: [],
};
const mockIdea = () => ({
  id: '12000000-0000-4000-8000-000000000001',
  projectId: fx.ids.project,
  source: 'ai' as const,
  teamFit: 0.86,
  selected: true,
  candidate: fx.planDocument.idea,
  createdAt: fx.project.createdAt,
});
const mockPlan = () => ({
  id: fx.ids.plan,
  projectId: fx.ids.project,
  version: 1,
  status: 'accepted' as const,
  payload: fx.planDocument,
  feasibility: mockFeasibility,
  model: 'mock',
  createdAt: fx.project.createdAt,
});

route(planning, 'getHackathon', ({ c }) => mockOr(c, 'T-302', () => fx.knightHacksIX));
route(planning, 'listProjects', ({ c }) => mockOr(c, 'T-302', () => [fx.project]));
route(planning, 'createProject', ({ c, body }) =>
  mockOr(c, 'T-302', () => ({ ...fx.project, name: body.name, status: 'ideating' as const })),
);
route(planning, 'getProject', ({ c }) => mockOr(c, 'T-302', () => fx.project));
route(planning, 'putConstraints', ({ c, body }) => mockOr(c, 'T-302', () => body));

route(planning, 'listIdeas', ({ c }) => mockOr(c, 'T-303', () => [mockIdea()]));
route(planning, 'submitIdea', ({ c }) =>
  mockOr(c, 'T-303', () => ({ ...mockIdea(), source: 'user' as const })),
);

sseRoute(planning, 'generateIdeas', async ({ c, send }) => {
  if (!c.var.mocks) throw notImplemented('T-303');
  await send({ type: 'stage', message: 'Reading team capability' });
  await send({ type: 'idea', idea: mockIdea() });
  await send({ type: 'done' });
});
sseRoute(planning, 'refineIdea', async ({ c, send }) => {
  if (!c.var.mocks) throw notImplemented('T-303');
  await send({ type: 'idea', idea: mockIdea() });
  await send({ type: 'done' });
});
sseRoute(planning, 'generatePlan', async ({ c, send }) => {
  if (!c.var.mocks) throw notImplemented('T-305');
  const events: PlanStreamEvent[] = [
    { type: 'stage', stage: 'outline', message: 'Drafting scope and architecture' },
    { type: 'outline', outline: fx.planDocument.outline },
    { type: 'stage', stage: 'tasks', message: 'Breaking epics into tasks' },
    { type: 'epic_tasks', epicKey: 'E1', tasks: fx.planDocument.tasks },
    { type: 'validation', feasibility: mockFeasibility },
    { type: 'done', planId: fx.ids.plan },
  ];
  for (const e of events) await send(e);
});

route(planning, 'getPlan', ({ c }) => mockOr(c, 'T-305', () => mockPlan()));
route(planning, 'patchPlan', ({ c }) => mockOr(c, 'T-307', () => mockPlan()));
route(planning, 'acceptPlan', ({ c }) => mockOr(c, 'T-308', () => fx.board));
