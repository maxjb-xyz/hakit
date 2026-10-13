import { z } from 'zod';
import { JobAccepted, Page } from './common';
import {
  CreateInvite,
  CreateWorkspace,
  Invite,
  InvitePreview,
  Me,
  Member,
  MemberProfile,
  UpdateMemberProfile,
  UpdateWorkspace,
  Workspace,
} from './identity';
import { MemberSkill, Skill, TeamCapability, UpsertMemberSkill } from './capability';
import { CreateProject, HackathonTemplate, Project, PutConstraints } from './hackathon';
import {
  GenerateIdeas,
  GeneratePlan,
  Idea,
  Plan,
  PlanPatch,
  PlanSummary,
  RefineIdea,
  SubmitIdea,
} from './planning';
import { CreateTask, PutDependency, Task, TaskHistory, UpdateTask } from './tasks';
import {
  AcceptAssignments,
  Assignment,
  AssignmentExplanation,
  AssignmentProposal,
  ManualAssign,
  ProjectBoard,
  SolveRequest,
} from './assignment';
import {
  ActivityEvent,
  ConnectRepo,
  CreateRepo,
  CreateRepoResult,
  InstallUrl,
  LinkActivity,
  MapAuthor,
  RepoSummary,
} from './activity';
import { MissionControlSnapshot } from './mission-control';
import { AcceptRecommendation, DismissRecommendation, Recommendation } from './recommendations';
import { AgentSession, AgentTokenCreated, AgentTokenSummary, CreateAgentToken, LinkSession } from './agents';
import { AiProviderStatus, AiUsage } from './ai';
import { AccountExport, DeleteWorkspace } from './privacy';
import { GithubManifestForm, SetupStatus, StartGithubSetup } from './setup';

/**
 * THE API CONTRACT. Every `/api/v1` JSON endpoint is declared here exactly once.
 * - Worker: `route(app, endpoints.x, handler)` validates body + response against these schemas.
 * - Client: `api.call('x', params, body)` is fully typed from this table.
 * Paths use `:param` segments. `kind: 'sse'` endpoints stream the listed `event` schema.
 * Changing an entry after the contracts freeze requires sign-off from all workstreams (CLAUDE.md).
 */
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export interface EndpointDef {
  method: Method;
  path: string;
  body?: z.ZodType;
  query?: z.ZodType;
  response?: z.ZodType;
  kind?: 'json' | 'sse';
  event?: z.ZodType;
  /** Owning workstream (docs/archive/HACKATHON.md §3). */
  owner: 'PL' | 'IN' | 'FE' | 'GH';
}

const Empty = z.object({});
const ok = z.object({ ok: z.literal(true) });

export const endpoints = {
  // Auth & identity (PL)
  me: { method: 'GET', path: '/me', response: Me, owner: 'PL' },
  logout: { method: 'POST', path: '/auth/logout', body: Empty, response: ok, owner: 'PL' },
  /** Everything stored about the signed-in user, as a JSON download (additive; no secrets). */
  exportMe: { method: 'GET', path: '/me/export', response: AccountExport, owner: 'PL' },
  /** Delete the signed-in user and their personal data; 409 while they are a sole owner with teammates (additive). */
  deleteMe: { method: 'DELETE', path: '/me', response: ok, owner: 'PL' },

  // Workspaces & members (PL)
  createWorkspace: {
    method: 'POST',
    path: '/workspaces',
    body: CreateWorkspace,
    response: Workspace,
    owner: 'PL',
  },
  getWorkspace: { method: 'GET', path: '/w/:wid', response: Workspace, owner: 'PL' },
  updateWorkspace: {
    method: 'PATCH',
    path: '/w/:wid',
    body: UpdateWorkspace,
    response: Workspace,
    owner: 'PL',
  },
  /** Owner only; `confirmName` must equal the workspace name. Deletes everything in it (additive). */
  deleteWorkspace: {
    method: 'DELETE',
    path: '/w/:wid',
    body: DeleteWorkspace,
    response: ok,
    owner: 'PL',
  },
  createInvite: {
    method: 'POST',
    path: '/w/:wid/invites',
    body: CreateInvite,
    response: Invite,
    owner: 'PL',
  },
  previewInvite: { method: 'GET', path: '/invites/:code', response: InvitePreview, owner: 'PL' },
  acceptInvite: {
    method: 'POST',
    path: '/invites/:code/accept',
    body: Empty,
    response: Workspace,
    owner: 'PL',
  },
  listMembers: { method: 'GET', path: '/w/:wid/members', response: z.array(Member), owner: 'PL' },
  getProfile: { method: 'GET', path: '/w/:wid/members/:uid/profile', response: MemberProfile, owner: 'PL' },
  updateProfile: {
    method: 'PATCH',
    path: '/w/:wid/members/:uid/profile',
    body: UpdateMemberProfile,
    response: MemberProfile,
    owner: 'PL',
  },

  // Capability (IN)
  importSkills: {
    method: 'POST',
    path: '/w/:wid/members/me/skills/import',
    body: Empty,
    response: JobAccepted,
    owner: 'IN',
  },
  memberSkills: {
    method: 'GET',
    path: '/w/:wid/members/:uid/skills',
    response: z.array(MemberSkill),
    owner: 'IN',
  },
  upsertSkill: {
    method: 'PUT',
    path: '/me/skills/:slug',
    body: UpsertMemberSkill,
    response: MemberSkill,
    owner: 'IN',
  },
  removeSkill: { method: 'DELETE', path: '/me/skills/:slug', response: ok, owner: 'IN' },
  searchSkills: {
    method: 'GET',
    path: '/skills',
    query: z.object({ q: z.string().default('') }),
    response: z.array(Skill),
    owner: 'IN',
  },
  teamCapability: { method: 'GET', path: '/w/:wid/capability', response: TeamCapability, owner: 'IN' },

  // Hackathon & projects (PL)
  getHackathon: { method: 'GET', path: '/hackathons/:slug', response: HackathonTemplate, owner: 'PL' },
  listProjects: { method: 'GET', path: '/w/:wid/projects', response: z.array(Project), owner: 'PL' },
  createProject: {
    method: 'POST',
    path: '/w/:wid/projects',
    body: CreateProject,
    response: Project,
    owner: 'PL',
  },
  getProject: { method: 'GET', path: '/projects/:pid', response: Project, owner: 'PL' },
  /** The project's pinned constraints (additive; pairs with putConstraints). */
  getConstraints: {
    method: 'GET',
    path: '/projects/:pid/constraints',
    response: PutConstraints,
    owner: 'PL',
  },
  putConstraints: {
    method: 'PUT',
    path: '/projects/:pid/constraints',
    body: PutConstraints,
    response: PutConstraints,
    owner: 'PL',
  },

  // Planning (IN)
  listIdeas: { method: 'GET', path: '/projects/:pid/ideas', response: z.array(Idea), owner: 'IN' },
  submitIdea: { method: 'POST', path: '/projects/:pid/ideas', body: SubmitIdea, response: Idea, owner: 'IN' },
  generateIdeas: {
    method: 'POST',
    path: '/projects/:pid/ideas/generate',
    body: GenerateIdeas,
    kind: 'sse',
    owner: 'IN',
  },
  refineIdea: {
    method: 'POST',
    path: '/projects/:pid/ideas/:iid/refine',
    body: RefineIdea,
    kind: 'sse',
    owner: 'IN',
  },
  generatePlan: {
    method: 'POST',
    path: '/projects/:pid/plans/generate',
    body: GeneratePlan,
    kind: 'sse',
    owner: 'IN',
  },
  /** Plan versions for the review screen's version switcher, newest first (additive, T-307). */
  listPlans: { method: 'GET', path: '/projects/:pid/plans', response: z.array(PlanSummary), owner: 'IN' },
  getPlan: { method: 'GET', path: '/projects/:pid/plans/:planId', response: Plan, owner: 'IN' },
  patchPlan: {
    method: 'PATCH',
    path: '/projects/:pid/plans/:planId',
    body: PlanPatch,
    response: Plan,
    owner: 'IN',
  },
  acceptPlan: {
    method: 'POST',
    path: '/projects/:pid/plans/:planId/accept',
    body: Empty,
    response: ProjectBoard,
    owner: 'PL',
  },

  // Tasks & assignment (PL board CRUD, IN solver)
  getBoard: { method: 'GET', path: '/projects/:pid/board', response: ProjectBoard, owner: 'PL' },
  createTask: { method: 'POST', path: '/projects/:pid/tasks', body: CreateTask, response: Task, owner: 'PL' },
  updateTask: { method: 'PATCH', path: '/tasks/:tid', body: UpdateTask, response: Task, owner: 'PL' },
  listTaskHistory: { method: 'GET', path: '/tasks/:tid/history', response: TaskHistory, owner: 'PL' },
  putDependency: {
    method: 'PUT',
    path: '/tasks/:tid/dependencies/:depId',
    body: PutDependency,
    response: ok,
    owner: 'PL',
  },
  deleteDependency: { method: 'DELETE', path: '/tasks/:tid/dependencies/:depId', response: ok, owner: 'PL' },
  solveAssignments: {
    method: 'POST',
    path: '/projects/:pid/assignments/solve',
    body: SolveRequest,
    response: AssignmentProposal,
    owner: 'IN',
  },
  acceptAssignments: {
    method: 'POST',
    path: '/projects/:pid/assignments/accept',
    body: AcceptAssignments,
    response: ProjectBoard,
    owner: 'PL',
  },
  manualAssign: {
    method: 'PUT',
    path: '/tasks/:tid/assignee',
    body: ManualAssign,
    /** null when the request unassigned the task. */
    response: Assignment.nullable(),
    owner: 'PL',
  },
  explainAssignment: {
    method: 'GET',
    path: '/tasks/:tid/explanation',
    response: AssignmentExplanation,
    owner: 'IN',
  },

  // GitHub & activity (GH)
  installUrl: {
    method: 'GET',
    path: '/github/install-url',
    query: z.object({ workspaceId: z.string() }),
    response: InstallUrl,
    owner: 'GH',
  },
  listRepos: { method: 'GET', path: '/github/repos', response: z.array(RepoSummary), owner: 'GH' },
  createRepo: {
    method: 'POST',
    path: '/github/repos',
    body: CreateRepo,
    response: CreateRepoResult,
    owner: 'GH',
  },
  connectRepo: {
    method: 'POST',
    path: '/projects/:pid/repo',
    body: ConnectRepo,
    response: RepoSummary,
    owner: 'GH',
  },
  listActivity: {
    method: 'GET',
    path: '/projects/:pid/activity',
    /** Optional source filter (additive). */
    query: z.object({ source: z.enum(['github', 'agent']).optional() }),
    response: Page(ActivityEvent),
    owner: 'GH',
  },
  linkActivity: {
    method: 'POST',
    path: '/activity/:eid/link',
    body: LinkActivity,
    response: ActivityEvent,
    owner: 'GH',
  },
  mapAuthor: { method: 'POST', path: '/w/:wid/author-aliases', body: MapAuthor, response: ok, owner: 'GH' },

  // Mission Control & adaptive (PL snapshot, IN rules)
  missionControl: {
    method: 'GET',
    path: '/projects/:pid/mission-control',
    response: MissionControlSnapshot,
    owner: 'PL',
  },
  listRecommendations: {
    method: 'GET',
    path: '/projects/:pid/recommendations',
    response: z.array(Recommendation),
    owner: 'IN',
  },
  acceptRecommendation: {
    method: 'POST',
    path: '/recommendations/:rid/accept',
    body: AcceptRecommendation,
    response: ProjectBoard,
    owner: 'PL',
  },
  dismissRecommendation: {
    method: 'POST',
    path: '/recommendations/:rid/dismiss',
    body: DismissRecommendation,
    response: Recommendation,
    owner: 'PL',
  },

  // Agents (GH)
  createAgentToken: {
    method: 'POST',
    path: '/w/:wid/agent-tokens',
    body: CreateAgentToken,
    response: AgentTokenCreated,
    owner: 'GH',
  },
  listAgentTokens: {
    method: 'GET',
    path: '/w/:wid/agent-tokens',
    response: z.array(AgentTokenSummary),
    owner: 'GH',
  },
  revokeAgentToken: { method: 'DELETE', path: '/agent-tokens/:id', response: ok, owner: 'GH' },
  listAgentSessions: {
    method: 'GET',
    path: '/projects/:pid/agent-sessions',
    response: z.array(AgentSession),
    owner: 'GH',
  },
  linkAgentSession: {
    method: 'PATCH',
    path: '/agent-sessions/:id',
    body: LinkSession,
    response: AgentSession,
    owner: 'GH',
  },

  // First-run setup (PL). Public until the GitHub App exists; see routes/setup.ts.
  setupStatus: { method: 'GET', path: '/setup', response: SetupStatus, owner: 'PL' },
  startGithubSetup: {
    method: 'POST',
    path: '/setup/github',
    body: StartGithubSetup,
    response: GithubManifestForm,
    owner: 'PL',
  },

  // Ops
  aiStatus: { method: 'GET', path: '/ai/status', response: z.array(AiProviderStatus), owner: 'IN' },
  /** Today's weighted AI calls for the workspace against AI_DAILY_LIMIT_PER_WORKSPACE (members). */
  aiUsage: { method: 'GET', path: '/w/:wid/ai/usage', response: AiUsage, owner: 'IN' },
} as const satisfies Record<string, EndpointDef>;

export type Endpoints = typeof endpoints;
export type EndpointName = keyof Endpoints;

type Infer<T> = T extends z.ZodType ? z.infer<T> : never;
type InferIn<T> = T extends z.ZodType ? z.input<T> : undefined;
export type EndpointBody<N extends EndpointName> = Endpoints[N] extends { body: infer B }
  ? InferIn<B>
  : undefined;
export type EndpointQuery<N extends EndpointName> = Endpoints[N] extends { query: infer Q }
  ? InferIn<Q>
  : undefined;
export type EndpointResponse<N extends EndpointName> = Endpoints[N] extends { response: infer R }
  ? Infer<R>
  : never;

/** Extract `:param` names from a path literal. */
export type PathParams<P extends string> = P extends `${string}:${infer Param}/${infer Rest}`
  ? { [K in Param | keyof PathParams<`/${Rest}`>]: string }
  : P extends `${string}:${infer Param}`
    ? { [K in Param]: string }
    : Record<never, never>;
export type EndpointParams<N extends EndpointName> = PathParams<Endpoints[N]['path']>;

export function buildPath(path: string, params: Record<string, string>): string {
  return path.replace(/:([A-Za-z]+)/g, (_m, name: string) => {
    const v = params[name];
    if (v === undefined) throw new Error(`Missing path param "${name}" for ${path}`);
    return encodeURIComponent(v);
  });
}

export const API_PREFIX = '/api/v1';
