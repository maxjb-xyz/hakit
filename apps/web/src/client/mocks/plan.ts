/**
 * Fake data for the Plan screen (S8, routes/Plan.tsx).
 *
 * Shapes come straight from @hakit/contracts, so they match what the backend returns:
 *   - `Plan`         ← GET /projects/:pid/plans/:planId   (endpoint `getPlan`, owner IN, task T-305)
 *   - `ProjectBoard` ← GET /projects/:pid/board            (endpoint `getBoard`, owner PL, task T-312)
 * The milestones and tasks reuse the shared demo fixtures so Plan, Tasks and Mission Control tell the same story.
 */
import type { Plan, ProjectBoard } from '@hakit/contracts';
import * as fx from '@hakit/contracts/fixtures';
import { fakeResponse } from './fake';

export const mockPlan: Plan = {
  id: fx.ids.plan,
  projectId: fx.ids.project,
  version: 2,
  status: 'accepted',
  payload: fx.planDocument,
  feasibility: {
    ok: true,
    requiredHours: 33,
    availableEffectiveHours: 79.8,
    criticalPathHours: 10,
    hoursUntilFinalMilestone: 16,
    cutTaskKeys: [],
    issues: [
      {
        code: 'SKILL_GAP',
        severity: 'warn',
        message: 'Only Priya has Cloudflare Workers experience: one person owns the deploy path.',
        refs: ['T1'],
      },
    ],
  },
  model: 'gemini-2.5-pro',
  createdAt: '2026-10-09T22:00:00-04:00',
};

export const mockBoard: ProjectBoard = fx.board;

/** TODO: replace with api call: `api('getPlan', { params: { pid, planId } })` */
export function fetchPlan(): Promise<Plan> {
  return fakeResponse(mockPlan);
}

/** TODO: replace with api call: `api('getBoard', { params: { pid } })` */
export function fetchBoard(): Promise<ProjectBoard> {
  return fakeResponse(mockBoard);
}
