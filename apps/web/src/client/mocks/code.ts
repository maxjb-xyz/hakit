/**
 * Fake data for the Code screen (S12, routes/Code.tsx).
 *
 * Shapes from @hakit/contracts (match the backend exactly):
 *   - `RepoSummary`     ← POST /projects/:pid/repo or GET /github/repos   (`connectRepo` / `listRepos`, owner GH, T-402)
 *   - `ActivityEvent[]` ← GET /projects/:pid/activity → `.items`          (`listActivity`, owner GH, T-403)
 *
 * NOT in the contract yet: `BranchSummary` and `PullRequestSummary` below are our proposal for the
 * "Branches table" and "PR list" in DESIGN S12. Today the same facts only exist spread across activity
 * events (`ref`, `prNumber`, `kind`). Raise this gap with GH (team channel) before relying on these shapes.
 */
import type { ActivityEvent, LinkKind, RepoSummary } from '@hakit/contracts';
import * as fx from '@hakit/contracts/fixtures';
import { fakeResponse } from './fake';

const u = fx.ids.users;
const t = fx.ids.task;
const REPO_ID = 987654321;
const REPO_URL = 'https://github.com/team-orbit/hakit';

export const mockRepo: RepoSummary = {
  id: REPO_ID,
  fullName: 'team-orbit/hakit',
  private: false,
  defaultBranch: 'main',
  htmlUrl: REPO_URL,
  installationId: 55501,
  pushedAt: '2026-10-10T10:52:00-04:00',
};

/* ----------------------------- activity feed ----------------------------- */

/** Fills in the fields most events leave empty, so each event below only lists what matters. */
function event(
  n: number,
  e: Partial<ActivityEvent> & Pick<ActivityEvent, 'ts' | 'kind' | 'title'>,
): ActivityEvent {
  return {
    id: fx.ids.activity(n),
    projectId: fx.ids.project,
    source: 'github',
    actorUserId: null,
    actorRaw: null,
    repoId: REPO_ID,
    ref: null,
    sha: null,
    prNumber: null,
    taskId: null,
    linkKind: 'none',
    linkConfidence: null,
    url: null,
    additions: null,
    deletions: null,
    agentSessionId: null,
    ...e,
  };
}

export const mockActivity: ActivityEvent[] = [
  event(11, {
    ts: '2026-10-10T10:56:00-04:00',
    kind: 'pr_review',
    actorUserId: u.sam,
    prNumber: 14,
    taskId: t(2),
    linkKind: 'confirmed',
    title: 'Approved #14 "Database schema & Hyperdrive"',
    url: `${REPO_URL}/pull/14`,
  }),
  event(1, {
    ts: '2026-10-10T10:52:00-04:00',
    kind: 'commit',
    actorUserId: u.priya,
    ref: 'hk-2-db-schema',
    sha: 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0',
    taskId: t(2),
    linkKind: 'confirmed',
    title: 'Add activity_events hypertable migration',
    url: `${REPO_URL}/commit/a1b2c3d`,
    additions: 84,
    deletions: 3,
  }),
  event(2, {
    ts: '2026-10-10T10:40:00-04:00',
    kind: 'commit',
    actorUserId: u.jae,
    ref: 'onboarding-wip',
    sha: 'b1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0',
    taskId: t(6),
    linkKind: 'inferred',
    linkConfidence: 0.71,
    title: 'welcome step layout',
    url: `${REPO_URL}/commit/b1b2c3d`,
    additions: 120,
    deletions: 10,
  }),
  event(12, {
    ts: '2026-10-10T10:31:00-04:00',
    kind: 'pr_opened',
    actorUserId: u.priya,
    ref: 'hk-2-db-schema',
    prNumber: 14,
    taskId: t(2),
    linkKind: 'confirmed',
    title: 'Opened #14 "Database schema & Hyperdrive"',
    url: `${REPO_URL}/pull/14`,
  }),
  event(13, {
    ts: '2026-10-10T10:12:00-04:00',
    kind: 'commit',
    actorRaw: 'jdoe@laptop.local',
    ref: 'main',
    sha: 'c1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0',
    title: 'fix typo in README',
    url: `${REPO_URL}/commit/c1b2c3d`,
    additions: 1,
    deletions: 1,
  }),
  event(14, {
    ts: '2026-10-10T09:05:00-04:00',
    kind: 'pr_merged',
    actorUserId: u.priya,
    ref: 'hk-3-design-tokens',
    prNumber: 12,
    taskId: t(3),
    linkKind: 'confirmed',
    title: 'Merged #12 "Design tokens & app shell"',
    url: `${REPO_URL}/pull/12`,
  }),
  event(15, {
    ts: '2026-10-10T08:40:00-04:00',
    kind: 'branch_created',
    actorUserId: u.sam,
    ref: 'hk-8-assignment-ui',
    taskId: t(8),
    linkKind: 'confirmed',
    title: 'Created branch hk-8-assignment-ui',
  }),
  event(16, {
    ts: '2026-10-10T07:50:00-04:00',
    kind: 'commit',
    actorUserId: u.marcus,
    ref: 'oauth-try',
    sha: 'd1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0',
    taskId: t(4),
    linkKind: 'inferred',
    linkConfidence: 0.58,
    title: 'wip github callback',
    url: `${REPO_URL}/commit/d1b2c3d`,
    additions: 42,
    deletions: 0,
  }),
];

/* ----------------------------- branches & PRs (proposed shapes) ----------------------------- */

/** Proposed, not in @hakit/contracts yet. One row of the S12 Branches table. */
export type BranchSummary = {
  name: string;
  authorUserId: string | null;
  taskId: string | null;
  linkKind: LinkKind;
  lastCommitAt: string;
  lastCommitSha: string;
  /** Commits ahead/behind the default branch; null if GitHub didn't tell us. */
  ahead: number | null;
  behind: number | null;
  prNumber: number | null;
};

export type PullRequestState = 'draft' | 'open' | 'merged' | 'closed';

/** Proposed, not in @hakit/contracts yet. One row of the S12 PR list. */
export type PullRequestSummary = {
  number: number;
  title: string;
  state: PullRequestState;
  authorUserId: string | null;
  branch: string;
  taskId: string | null;
  linkKind: LinkKind;
  approvals: number;
  changesRequested: number;
  additions: number;
  deletions: number;
  updatedAt: string;
  url: string;
};

export const mockBranches: BranchSummary[] = [
  {
    name: 'hk-2-db-schema',
    authorUserId: u.priya,
    taskId: t(2),
    linkKind: 'confirmed',
    lastCommitAt: '2026-10-10T10:52:00-04:00',
    lastCommitSha: 'a1b2c3d',
    ahead: 6,
    behind: 0,
    prNumber: 14,
  },
  {
    name: 'onboarding-wip',
    authorUserId: u.jae,
    taskId: t(6),
    linkKind: 'inferred',
    lastCommitAt: '2026-10-10T10:40:00-04:00',
    lastCommitSha: 'b1b2c3d',
    ahead: 3,
    behind: 2,
    prNumber: null,
  },
  {
    name: 'hk-8-assignment-ui',
    authorUserId: u.sam,
    taskId: t(8),
    linkKind: 'confirmed',
    lastCommitAt: '2026-10-10T10:20:00-04:00',
    lastCommitSha: 'e1b2c3d',
    ahead: 4,
    behind: 1,
    prNumber: 15,
  },
  {
    name: 'oauth-try',
    authorUserId: u.marcus,
    taskId: t(4),
    linkKind: 'inferred',
    lastCommitAt: '2026-10-10T07:50:00-04:00',
    lastCommitSha: 'd1b2c3d',
    ahead: 1,
    behind: 7,
    prNumber: null,
  },
];

export const mockPullRequests: PullRequestSummary[] = [
  {
    number: 15,
    title: 'Assignment review UI',
    state: 'draft',
    authorUserId: u.sam,
    branch: 'hk-8-assignment-ui',
    taskId: t(8),
    linkKind: 'confirmed',
    approvals: 0,
    changesRequested: 0,
    additions: 312,
    deletions: 18,
    updatedAt: '2026-10-10T10:20:00-04:00',
    url: `${REPO_URL}/pull/15`,
  },
  {
    number: 14,
    title: 'Database schema & Hyperdrive',
    state: 'open',
    authorUserId: u.priya,
    branch: 'hk-2-db-schema',
    taskId: t(2),
    linkKind: 'confirmed',
    approvals: 1,
    changesRequested: 0,
    additions: 410,
    deletions: 12,
    updatedAt: '2026-10-10T10:56:00-04:00',
    url: `${REPO_URL}/pull/14`,
  },
  {
    number: 12,
    title: 'Design tokens & app shell',
    state: 'merged',
    authorUserId: u.priya,
    branch: 'hk-3-design-tokens',
    taskId: t(3),
    linkKind: 'confirmed',
    approvals: 2,
    changesRequested: 0,
    additions: 640,
    deletions: 35,
    updatedAt: '2026-10-10T09:05:00-04:00',
    url: `${REPO_URL}/pull/12`,
  },
  {
    number: 11,
    title: 'Try Auth.js for GitHub login',
    state: 'closed',
    authorUserId: u.marcus,
    branch: 'authjs-spike',
    taskId: t(4),
    linkKind: 'inferred',
    approvals: 0,
    changesRequested: 1,
    additions: 95,
    deletions: 4,
    updatedAt: '2026-10-10T06:30:00-04:00',
    url: `${REPO_URL}/pull/11`,
  },
];

/** TODO: replace with api call: `api('getProject', …)` for `repoId`, then the matching `api('listRepos')` entry */
export function fetchRepo(): Promise<RepoSummary> {
  return fakeResponse(mockRepo);
}

/** TODO: replace with api call: `api('listActivity', { params: { pid } }).then((page) => page.items)` */
export function fetchActivity(): Promise<ActivityEvent[]> {
  return fakeResponse(mockActivity);
}

/** TODO: replace with api call once GH adds a branches endpoint (no contract yet). */
export function fetchBranches(): Promise<BranchSummary[]> {
  return fakeResponse(mockBranches);
}

/** TODO: replace with api call once GH adds a pull-requests endpoint (no contract yet). */
export function fetchPullRequests(): Promise<PullRequestSummary[]> {
  return fakeResponse(mockPullRequests);
}
