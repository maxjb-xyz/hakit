/**
 * Fake data for the Team screen (S5, routes/Team.tsx). Other screens use `fetchMembers` for avatars too.
 *
 * Shapes come straight from @hakit/contracts, so they match what the backend returns:
 *   - `Member[]`  ← GET /w/:wid/members                    (endpoint `listMembers`, owner PL, task T-202)
 *   - `TeamLane`  ← one entry of `lanes` in GET /projects/:pid/mission-control (endpoint `missionControl`,
 *                   owner PL, task T-502). The backend has no separate "presence" endpoint: a member's online
 *                   status is worked out from `availableNow` + `lastActivityAt` on their lane.
 */
import type { Member, MissionControlSnapshot } from '@hakit/contracts';
import * as fx from '@hakit/contracts/fixtures';
import { fakeResponse } from './fake';

export type TeamLane = MissionControlSnapshot['lanes'][number];

/** Priya (owner), Marcus, Jae and Sam: the shared demo team. */
export const mockMembers: Member[] = fx.members;

const u = fx.ids.users;
const t = fx.ids.task;

export const mockLanes: TeamLane[] = [
  {
    userId: u.priya,
    currentTaskId: t(2),
    lastActivityAt: '2026-10-10T10:52:00-04:00',
    assignedHours: 5,
    availableHours: 30,
    availableNow: true,
    agentSessions: [],
    sparkline: [],
  },
  {
    userId: u.marcus,
    currentTaskId: t(4),
    lastActivityAt: '2026-10-10T07:50:00-04:00',
    assignedHours: 7,
    availableHours: 28,
    availableNow: true,
    agentSessions: [],
    sparkline: [],
  },
  {
    userId: u.jae,
    currentTaskId: t(6),
    lastActivityAt: '2026-10-10T09:40:00-04:00',
    assignedHours: 6,
    availableHours: 26,
    // Jae marked a sleep window in their availability, so they're away right now.
    availableNow: false,
    agentSessions: [],
    sparkline: [],
  },
  {
    userId: u.sam,
    currentTaskId: null,
    lastActivityAt: '2026-10-10T10:58:00-04:00',
    assignedHours: 11,
    availableHours: 30,
    availableNow: true,
    agentSessions: [
      { id: fx.ids.session(1), status: 'awaiting_input', taskId: null },
      { id: fx.ids.session(2), status: 'active', taskId: t(8) },
    ],
    sparkline: [],
  },
];

/** TODO: replace with api call: `api('listMembers', { params: { wid } })` */
export function fetchMembers(): Promise<Member[]> {
  return fakeResponse(mockMembers);
}

/** TODO: replace with api call: `api('missionControl', { params: { pid } }).then((s) => s.lanes)` */
export function fetchTeamLanes(): Promise<TeamLane[]> {
  return fakeResponse(mockLanes);
}
