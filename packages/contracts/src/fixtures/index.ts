/**
 * Shared demo fixtures. Every workstream develops and tests against these until real data flows.
 * All objects are validated against their schemas in fixtures.test.ts — keep them valid.
 * The scenario: 4-person team at Knight Hacks IX building "Hakit" itself, ~14h into the event,
 * with HK-4 (GitHub OAuth) stalled on the critical path — the adaptive demo moment.
 */
import type {
  ActivityEvent,
  AgentSession,
  Assignment,
  HackathonTemplate,
  Member,
  MemberSkill,
  Milestone,
  MissionControlSnapshot,
  PlanDocument,
  Project,
  ProjectBoard,
  Recommendation,
  Task,
  TaskDependency,
  TeamCapability,
  Workspace,
} from '../index';

/* ----------------------------- deterministic ids ----------------------------- */
const uid = (prefix: string, n: number) =>
  `${prefix}000000-0000-4000-8000-${String(n).padStart(12, '0')}`.slice(0, 36);
export const ids = {
  workspace: uid('10', 1),
  project: uid('20', 1),
  hackathon: uid('30', 1),
  users: { priya: uid('40', 1), marcus: uid('40', 2), jae: uid('40', 3), sam: uid('40', 4) },
  milestones: [uid('50', 1), uid('50', 2), uid('50', 3)] as const,
  task: (n: number) => uid('60', n),
  assignment: (n: number) => uid('70', n),
  activity: (n: number) => uid('80', n),
  rec: (n: number) => uid('90', n),
  session: (n: number) => uid('a0', n),
  plan: uid('b0', 1),
  challenge: (n: number) => uid('c0', n),
  skill: (n: number) => uid('d0', n),
  evidence: (n: number) => uid('e0', n),
};

const EVENT_START = '2026-10-09T21:00:00-04:00';
const NOW = '2026-10-10T11:00:00-04:00';
const DEADLINE = '2026-10-11T09:00:00-04:00';
const at = (iso: string) => iso;

/* --------------------------------- hackathon --------------------------------- */
export const knightHacksIX: HackathonTemplate = {
  id: ids.hackathon,
  slug: 'knight-hacks-ix',
  name: 'Knight Hacks IX',
  startsAt: EVENT_START,
  endsAt: DEADLINE,
  timezone: 'America/New_York',
  tracks: [
    { key: 'hello-world', name: 'Hello World' },
    { key: 'ai-ml', name: 'Artificial Intelligence / Machine Learning' },
    { key: 'app-dev', name: 'App Development' },
    { key: 'game-dev', name: 'Game Development' },
    { key: 'embedded', name: 'Embedded Software' },
  ],
  judgingCriteria: [
    { key: 'general', name: 'General and sponsor judges (rubric in Hackers Guide — unverified)' },
  ],
  challenges: [
    {
      id: ids.challenge(1),
      sponsor: 'Hugging Face',
      title: 'Hugging Face challenge (wording unverified)',
      description: 'Placeholder until confirmed on Devpost.',
      requirements: ['Use open-weight models from the Hugging Face Hub'],
      requiredTech: ['huggingface-transformers'],
      prize: null,
      url: null,
      verified: false,
    },
    {
      id: ids.challenge(2),
      sponsor: 'AMD',
      title: 'Best use of AMD Hardware/Software (2025 precedent, unverified)',
      description: 'Placeholder until confirmed on Devpost.',
      requirements: ['Run a meaningful workload on AMD hardware or software (e.g. ROCm on Instinct GPUs)'],
      requiredTech: ['rocm'],
      prize: null,
      url: null,
      verified: false,
    },
  ],
  sourceUrl: 'https://2026.knighthacks.org/',
};

export const workspace: Workspace = {
  id: ids.workspace,
  name: 'Team Orbit',
  slug: 'team-orbit',
  hackathonTemplateId: ids.hackathon,
  startsAt: EVENT_START,
  deadlineAt: DEADLINE,
  createdAt: at('2026-10-09T21:05:00-04:00'),
};

export const project: Project = {
  id: ids.project,
  workspaceId: ids.workspace,
  name: 'Hakit',
  pitch: 'The hackathon OS that knows your team and knows what to build next.',
  status: 'active',
  repoId: 987654321,
  currentPlanId: ids.plan,
  createdAt: at('2026-10-09T21:10:00-04:00'),
};

/* ---------------------------------- members ---------------------------------- */
const profile = (
  userId: string,
  hours: number,
  extra: Partial<Member['profile']> = {},
): Member['profile'] => ({
  userId,
  workspaceId: ids.workspace,
  headline: null,
  timezone: 'America/New_York',
  interests: [],
  learningGoals: [],
  avoid: [],
  availability: [
    { start: EVENT_START, end: '2026-10-10T03:00:00-04:00', kind: 'available' },
    { start: '2026-10-10T03:00:00-04:00', end: '2026-10-10T07:00:00-04:00', kind: 'sleep' },
    { start: '2026-10-10T07:00:00-04:00', end: DEADLINE, kind: 'available' },
  ],
  availableHours: hours,
  onboardingCompletedAt: at('2026-10-09T21:30:00-04:00'),
  ...extra,
});

export const members: Member[] = [
  {
    user: {
      id: ids.users.priya,
      githubUserId: 1001,
      githubLogin: 'priya-dev',
      name: 'Priya Raman',
      avatarUrl: null,
    },
    role: 'owner',
    colorIndex: 0,
    profile: profile(ids.users.priya, 30, {
      headline: 'Full-stack, likes infra',
      interests: ['developer tools'],
    }),
    topSkills: [
      { slug: 'typescript', level: 5, confirmed: true },
      { slug: 'cloudflare-workers', level: 4, confirmed: true },
      { slug: 'postgres', level: 4, confirmed: true },
    ],
    currentTaskId: ids.task(2),
  },
  {
    user: {
      id: ids.users.marcus,
      githubUserId: 1002,
      githubLogin: 'marcus-b',
      name: 'Marcus Bell',
      avatarUrl: null,
    },
    role: 'member',
    colorIndex: 1,
    profile: profile(ids.users.marcus, 28, { headline: 'Backend + ML', learningGoals: ['rocm'] }),
    topSkills: [
      { slug: 'python', level: 5, confirmed: true },
      { slug: 'pytorch', level: 4, confirmed: true },
      { slug: 'embeddings', level: 4, confirmed: false },
    ],
    currentTaskId: ids.task(4),
  },
  {
    user: { id: ids.users.jae, githubUserId: 1003, githubLogin: 'jae-k', name: 'Jae Kim', avatarUrl: null },
    role: 'member',
    colorIndex: 2,
    profile: profile(ids.users.jae, 26, {
      headline: 'First hackathon!',
      learningGoals: ['react'],
      interests: ['ui design'],
    }),
    topSkills: [
      { slug: 'figma', level: 4, confirmed: true },
      { slug: 'javascript', level: 2, confirmed: true },
      { slug: 'react', level: 2, confirmed: false },
    ],
    currentTaskId: ids.task(6),
  },
  {
    user: {
      id: ids.users.sam,
      githubUserId: 1004,
      githubLogin: 'sam-agents',
      name: 'Sam Ortiz',
      avatarUrl: null,
    },
    role: 'member',
    colorIndex: 3,
    profile: profile(ids.users.sam, 30, { headline: 'Runs three Claude Code sessions at once' }),
    topSkills: [
      { slug: 'react', level: 5, confirmed: true },
      { slug: 'typescript', level: 4, confirmed: true },
      { slug: 'tailwindcss', level: 4, confirmed: true },
    ],
    currentTaskId: null,
  },
];

export const priyaSkills: MemberSkill[] = [
  {
    skill: {
      id: ids.skill(1),
      slug: 'cloudflare-workers',
      name: 'Cloudflare Workers',
      category: 'infra_devops',
      aliases: ['workers'],
    },
    level: 4,
    confidence: 0.86,
    source: 'confirmed',
    confirmedAt: at('2026-10-09T21:25:00-04:00'),
    evidence: [
      {
        id: ids.evidence(1),
        skillSlug: 'cloudflare-workers',
        kind: 'manifest_dependency',
        sourceRef: 'priya-dev/edge-notes',
        url: 'https://github.com/priya-dev/edge-notes',
        weight: 0.92,
        summary: 'wrangler + @cloudflare/workers-types in package.json',
        observedAt: at('2026-08-02T12:00:00-04:00'),
      },
    ],
  },
];

/** Compact seeds → MemberSkill rows, so mock mode shows a different skill set per member. */
type SkillSeed = [
  slug: string,
  name: string,
  category: MemberSkill['skill']['category'],
  level: number,
  inferred: boolean,
  repo: string,
  summary: string,
];
let skillN = 100;
const seedSkills = (login: string, seeds: SkillSeed[]): MemberSkill[] =>
  seeds.map(([slug, name, category, level, inferred, repo, summary]) => {
    const n = ++skillN;
    return {
      skill: { id: ids.skill(n), slug, name, category, aliases: [] },
      level,
      confidence: inferred ? 0.62 : 0.88,
      source: inferred ? 'inferred' : 'confirmed',
      confirmedAt: inferred ? null : at('2026-10-09T21:25:00-04:00'),
      evidence: [
        {
          id: ids.evidence(n),
          skillSlug: slug,
          kind: 'manifest_dependency',
          sourceRef: `${login}/${repo}`,
          url: `https://github.com/${login}/${repo}`,
          weight: inferred ? 0.4 : 0.9,
          summary,
          observedAt: at('2026-08-02T12:00:00-04:00'),
        },
      ],
    };
  });

export const memberSkillsByUser: Record<string, MemberSkill[]> = {
  [ids.users.priya]: [
    ...priyaSkills,
    ...seedSkills('priya-dev', [
      ['typescript', 'TypeScript', 'frontend', 4, false, 'edge-notes', 'typescript in package.json'],
      ['postgres', 'PostgreSQL', 'backend', 4, false, 'pg-queue', 'pg + drizzle-orm in package.json'],
      ['timescaledb', 'TimescaleDB', 'data', 3, false, 'metrics-lab', 'hypertable migrations'],
      ['pytorch', 'PyTorch', 'ml_ai', 1, true, 'notebooks', 'torch in requirements.txt'],
    ]),
  ],
  [ids.users.marcus]: seedSkills('marcus-b', [
    ['python', 'Python', 'backend', 5, false, 'triage-api', '92% Python by bytes'],
    ['pandas', 'pandas', 'data', 4, false, 'ingest', 'pandas in requirements.txt'],
    ['pytorch', 'PyTorch', 'ml_ai', 4, false, 'sev-model', 'torch + lightning in pyproject.toml'],
    ['docker', 'Docker', 'infra_devops', 3, false, 'triage-api', 'Dockerfile + compose.yaml'],
    ['react', 'React', 'frontend', 1, true, 'dash', 'react in package.json, 3 commits'],
  ]),
  [ids.users.jae]: seedSkills('jae-k', [
    ['figma', 'Figma', 'design_ux', 4, false, 'portfolio', 'Figma exports in /design'],
    ['javascript', 'JavaScript', 'frontend', 2, false, 'portfolio', 'vanilla JS site'],
    ['pytorch', 'PyTorch', 'ml_ai', 1, true, 'class-hw', 'torch in requirements.txt'],
  ]),
  [ids.users.sam]: seedSkills('sam-agents', [
    ['react', 'React', 'frontend', 5, false, 'agent-hud', 'react + vite in package.json'],
    ['node', 'Node.js', 'backend', 3, false, 'agent-hud', 'express server'],
    ['react-native', 'React Native', 'mobile', 2, false, 'pocket-hud', 'react-native in package.json'],
    ['cloudflare-workers', 'Cloudflare Workers', 'infra_devops', 2, true, 'agent-hud', 'wrangler.toml'],
  ]),
};

export const teamCapability: TeamCapability = {
  workspaceId: ids.workspace,
  categories: [
    {
      category: 'frontend',
      coverage: 4.6,
      label: 'strong',
      busFactor: 1,
      topMembers: [{ userId: ids.users.sam, effectiveLevel: 5 }],
    },
    {
      category: 'backend',
      coverage: 4.2,
      label: 'strong',
      busFactor: 2,
      topMembers: [{ userId: ids.users.priya, effectiveLevel: 4.5 }],
    },
    {
      category: 'ml_ai',
      coverage: 3.6,
      label: 'strong',
      busFactor: 1,
      topMembers: [{ userId: ids.users.marcus, effectiveLevel: 4 }],
    },
    {
      category: 'design_ux',
      coverage: 3.4,
      label: 'adequate',
      busFactor: 1,
      topMembers: [{ userId: ids.users.jae, effectiveLevel: 4 }],
    },
    { category: 'mobile', coverage: 0, label: 'gap', busFactor: 0, topMembers: [] },
  ],
  gaps: [{ category: 'mobile', note: 'No mobile experience — prefer a responsive web app.' }],
  overlaps: [{ skillSlug: 'typescript', userIds: [ids.users.priya, ids.users.sam] }],
  availabilityCurve: [
    { bucketStart: '2026-10-09T21:00:00-04:00', hours: 8 },
    { bucketStart: '2026-10-09T23:00:00-04:00', hours: 8 },
    { bucketStart: '2026-10-10T01:00:00-04:00', hours: 6 },
  ],
  totalAvailableHours: 114,
  totalEffectiveHours: 79.8,
  aiSummary: null,
};

/* ------------------------------------ plan ----------------------------------- */
export const planDocument: PlanDocument = {
  idea: {
    title: 'Hakit',
    pitch:
      'An operating system for hackathon teams: capability-aware plans, explainable assignments, adaptive execution.',
    problem: 'Teams lose hours to coordination and discover blockers too late.',
    targetUser: 'Hackathon teams of 3–5 using AI coding agents',
    coreFeatures: [
      'Skill import from GitHub',
      'AI plan generation',
      'Explainable assignment',
      'Live Mission Control',
    ],
    challengesAddressed: [
      { challengeKey: 'C1', how: 'Qwen3 embeddings from the HF Hub power skill matching' },
    ],
    stack: [
      { component: 'Web app', tech: 'React + Vite', skillSlugs: ['react', 'typescript'] },
      { component: 'API', tech: 'Hono on Cloudflare Workers', skillSlugs: ['cloudflare-workers'] },
    ],
    complexity: 4,
    risks: ['GitHub App setup time'],
    whyThisTeam: [
      'M1 has shipped Workers apps',
      'M2 has embedding experience',
      'M4 is a strong React developer',
    ],
  },
  outline: {
    summary: 'Ship the P0 journey end to end, then the stall→reassign demo.',
    scope: {
      must: ['Auth', 'Planning', 'Assignment', 'Mission Control'],
      should: ['Agent visibility'],
      could: ['Voice briefing'],
      outOfScope: ['Chat'],
    },
    architecture: {
      components: [
        {
          name: 'Worker',
          responsibility: 'API + realtime',
          tech: 'Hono',
          skillSlugs: ['cloudflare-workers'],
        },
      ],
      dataFlow: ['GitHub -> Worker: webhook', 'Worker -> Browser: WebSocket event'],
    },
    milestones: [
      { key: 'M1', title: 'Foundations', targetHour: 6 },
      { key: 'M2', title: 'Plan & assign', targetHour: 18 },
      { key: 'M3', title: 'Live demo', targetHour: 30 },
    ],
    epics: [{ key: 'E1', title: 'Auth & team', milestoneKey: 'M1', scopeTier: 'must', challengeKeys: [] }],
    risks: ['Gemini rate limits'],
  },
  tasks: [
    {
      key: 'T1',
      epicKey: 'E1',
      title: 'GitHub OAuth sign-in',
      description: 'GitHub App user-to-server flow with sessions.',
      acceptanceCriteria: ['User can sign in and see /me'],
      estimateHours: 3,
      requiredSkills: [
        { slug: 'cloudflare-workers', level: 3, weight: 0.6 },
        { slug: 'auth-oauth', level: 3, weight: 0.4 },
      ],
      dependsOn: [],
      priority: 'must',
    },
  ],
};

/* ------------------------------------ board ---------------------------------- */
export const milestones: Milestone[] = [
  {
    id: ids.milestones[0],
    projectId: ids.project,
    title: 'Foundations',
    ordinal: 1,
    targetAt: '2026-10-10T03:00:00-04:00',
    description: null,
  },
  {
    id: ids.milestones[1],
    projectId: ids.project,
    title: 'Plan & assign',
    ordinal: 2,
    targetAt: '2026-10-10T15:00:00-04:00',
    description: null,
  },
  {
    id: ids.milestones[2],
    projectId: ids.project,
    title: 'Live demo',
    ordinal: 3,
    targetAt: '2026-10-11T03:00:00-04:00',
    description: null,
  },
];

type TaskSeed = [
  n: number,
  title: string,
  status: Task['status'],
  m: 0 | 1 | 2,
  est: number,
  assignee: string | null,
  skills: [string, number][],
];
const taskSeeds: TaskSeed[] = [
  [1, 'Monorepo scaffold & deploy pipeline', 'done', 0, 2, ids.users.priya, [['cloudflare-workers', 3]]],
  [
    2,
    'Database schema & Hyperdrive',
    'in_progress',
    0,
    3,
    ids.users.priya,
    [
      ['postgres', 3],
      ['timescaledb', 2],
    ],
  ],
  [
    3,
    'Design tokens & app shell',
    'done',
    0,
    3,
    ids.users.jae,
    [
      ['figma', 3],
      ['tailwindcss', 2],
    ],
  ],
  [
    4,
    'GitHub OAuth sign-in',
    'in_progress',
    0,
    3,
    ids.users.marcus,
    [
      ['auth-oauth', 3],
      ['cloudflare-workers', 3],
    ],
  ],
  [
    5,
    'Skill import job',
    'todo',
    1,
    4,
    ids.users.marcus,
    [
      ['embeddings', 3],
      ['typescript', 3],
    ],
  ],
  [
    6,
    'Onboarding screens',
    'in_progress',
    1,
    3,
    ids.users.jae,
    [
      ['react', 2],
      ['figma', 3],
    ],
  ],
  [
    7,
    'Plan generation pipeline',
    'todo',
    1,
    4,
    ids.users.priya,
    [
      ['llm-apis', 3],
      ['typescript', 3],
    ],
  ],
  [
    8,
    'Assignment review UI',
    'todo',
    1,
    4,
    ids.users.sam,
    [
      ['react', 4],
      ['typescript', 3],
    ],
  ],
  [9, 'Webhook ingestion', 'todo', 2, 3, ids.users.sam, [['cloudflare-workers', 3]]],
  [10, 'Mission Control live', 'todo', 2, 4, ids.users.sam, [['react', 4]]],
];

export const tasks: Task[] = taskSeeds.map(([n, title, status, m, est, assignee, skills]) => ({
  id: ids.task(n),
  projectId: ids.project,
  key: `HK-${n}`,
  milestoneId: ids.milestones[m],
  title,
  description: '',
  acceptanceCriteria: [],
  status,
  priority: n === 10 ? 'should' : 'must',
  estimateHours: est,
  requiredSkills: skills.map(([skillSlug, level]) => ({ skillSlug, level, weight: 1 / skills.length })),
  source: 'plan',
  assigneeId: assignee,
  startedAt: status === 'todo' ? null : '2026-10-10T07:30:00-04:00',
  completedAt: status === 'done' ? '2026-10-10T09:00:00-04:00' : null,
  updatedAt: NOW,
}));

export const dependencies: TaskDependency[] = [
  [2, 1],
  [4, 1],
  [5, 4],
  [5, 2],
  [6, 3],
  [7, 2],
  [8, 7],
  [8, 3],
  [9, 4],
  [10, 8],
  [10, 9],
].map(([t, d]) => ({ taskId: ids.task(t!), dependsOnTaskId: ids.task(d!), kind: 'blocks' as const }));

const breakdown = (total: number): Assignment['breakdown'] => ({
  relevance: +(total * 0.6).toFixed(3),
  workload: +(total * 0.2).toFixed(3),
  preference: 0,
  continuity: +(total * 0.1).toFixed(3),
  availability: +(total * 0.1).toFixed(3),
  criticalPathPenalty: 0,
  total,
  relevanceParts: { skillFit: 0.82, semanticFit: 0.64, interestFit: 0.2 },
});

export const assignments: Assignment[] = tasks
  .filter((t) => t.assigneeId)
  .map((t, i) => ({
    id: ids.assignment(i + 1),
    taskId: t.id,
    userId: t.assigneeId!,
    status: 'active',
    source: 'solver',
    locked: false,
    score: 0.78,
    breakdown: breakdown(0.78),
    reasonCodes: [`STRONG_SKILL_MATCH:${t.requiredSkills[0]!.skillSlug}`, 'BALANCES_LOAD'],
    explanation: `Strongest ${t.requiredSkills[0]!.skillSlug} match on the team with capacity remaining.`,
    explanationSource: 'template',
    alternatives: [
      { userId: ids.users.sam, score: 0.66, delta: -0.12, reasonCodes: ['PARTIAL_SKILL_MATCH:typescript'] },
    ],
    createdAt: '2026-10-09T22:00:00-04:00',
  }));

export const board: ProjectBoard = { projectId: ids.project, milestones, tasks, dependencies, assignments };

/* ---------------------------------- activity --------------------------------- */
export const activity: ActivityEvent[] = [
  {
    id: ids.activity(1),
    ts: '2026-10-10T10:52:00-04:00',
    projectId: ids.project,
    source: 'github',
    kind: 'commit',
    actorUserId: ids.users.priya,
    actorRaw: null,
    repoId: 987654321,
    ref: 'hk-2-db-schema',
    sha: 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0',
    prNumber: null,
    taskId: ids.task(2),
    linkKind: 'confirmed',
    linkConfidence: null,
    title: 'Add activity_events hypertable migration',
    url: 'https://github.com/team-orbit/hakit/commit/a1b2c3d',
    additions: 84,
    deletions: 3,
    agentSessionId: null,
  },
  {
    id: ids.activity(2),
    ts: '2026-10-10T10:40:00-04:00',
    projectId: ids.project,
    source: 'github',
    kind: 'commit',
    actorUserId: ids.users.jae,
    actorRaw: null,
    repoId: 987654321,
    ref: 'onboarding-wip',
    sha: 'b1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0',
    prNumber: null,
    taskId: ids.task(6),
    linkKind: 'inferred',
    linkConfidence: 0.71,
    title: 'welcome step layout',
    url: 'https://github.com/team-orbit/hakit/commit/b1b2c3d',
    additions: 120,
    deletions: 10,
    agentSessionId: null,
  },
  {
    id: ids.activity(3),
    ts: '2026-10-10T10:58:00-04:00',
    projectId: ids.project,
    source: 'agent',
    kind: 'agent_awaiting_input',
    actorUserId: ids.users.sam,
    actorRaw: null,
    repoId: null,
    ref: 'main',
    sha: null,
    prNumber: null,
    taskId: null,
    linkKind: 'none',
    linkConfidence: null,
    title: 'Claude Code is waiting for permission',
    url: null,
    additions: null,
    deletions: null,
    agentSessionId: ids.session(1),
  },
];

export const agentSessions: AgentSession[] = [
  {
    id: ids.session(1),
    externalSessionId: 'cc-7f3a',
    userId: ids.users.sam,
    workspaceId: ids.workspace,
    projectId: ids.project,
    agent: 'claude_code',
    repoFullName: 'team-orbit/hakit',
    branch: 'main',
    status: 'awaiting_input',
    taskId: null,
    linkKind: 'none',
    startedAt: '2026-10-10T10:20:00-04:00',
    lastEventAt: '2026-10-10T10:58:00-04:00',
    endedAt: null,
    summary: { toolCounts: { Edit: 12, Bash: 5 }, subagents: 0, awaitingSince: '2026-10-10T10:58:00-04:00' },
  },
];

/* ------------------------------ recommendations ------------------------------ */
export const stallRecommendation: Recommendation = {
  id: ids.rec(1),
  projectId: ids.project,
  kind: 'reassign',
  severity: 'warn',
  dedupeKey: `stall:${ids.task(4)}`,
  headline: 'HK-4 GitHub OAuth has stalled on the critical path',
  rationale:
    'No linked commits for 3h 10m while 3 tasks wait on it. Sam is idle with an 82% match and owns HK-9, which depends on HK-4.',
  impact: { criticalPathHoursSaved: 2, tasksUnblocked: 3 },
  actions: [{ op: 'reassign', taskId: ids.task(4), toUserId: ids.users.sam }],
  signals: [
    { label: 'Last linked activity', value: '3h 10m ago' },
    { label: 'Downstream tasks', value: 'HK-5, HK-9, HK-10' },
    { label: 'Sam match', value: '0.82' },
  ],
  status: 'open',
  createdAt: '2026-10-10T10:59:00-04:00',
  resolvedAt: null,
  resolvedBy: null,
};

/* ------------------------------- mission control ----------------------------- */
export const missionControl: MissionControlSnapshot = {
  projectId: ids.project,
  generatedAt: NOW,
  deadlineAt: DEADLINE,
  health: {
    status: 'at_risk',
    reasonCode: 'CRITICAL_TASK_STALLED',
    reason: 'HK-4 is stalled and blocks 3 tasks.',
  },
  progress: {
    measuredDone: 5 / 33,
    tasksDone: 2,
    tasksTotal: 10,
    forecastFinishAt: '2026-10-11T07:30:00-04:00',
    velocityHoursPerHour: 1.6,
  },
  criticalPath: {
    taskIds: [ids.task(1), ids.task(4), ids.task(9), ids.task(10)],
    remainingHours: 10,
    slackHours: 1.5,
  },
  milestones: milestones.map((m, i) => ({
    id: m.id,
    title: m.title,
    targetAt: m.targetAt,
    measuredDone: [0.5, 0, 0][i]!,
    tasksDone: [2, 0, 0][i]!,
    tasksTotal: [4, 4, 2][i]!,
  })),
  lanes: members.map((m, i) => ({
    userId: m.user.id,
    currentTaskId: m.currentTaskId,
    lastActivityAt: i === 1 ? '2026-10-10T07:50:00-04:00' : '2026-10-10T10:52:00-04:00',
    assignedHours: [5, 7, 6, 11][i]!,
    availableHours: m.profile.availableHours,
    availableNow: true,
    agentSessions: i === 3 ? [{ id: ids.session(1), status: 'awaiting_input' as const, taskId: null }] : [],
    sparkline: Array.from({ length: 24 }, (_, k) => (i === 1 && k > 11 ? 0 : (k * (i + 3)) % 5)),
  })),
  blockers: [
    {
      taskId: ids.task(5),
      blockedByTaskIds: [ids.task(4)],
      ownerId: ids.users.marcus,
      since: '2026-10-10T09:00:00-04:00',
    },
  ],
  recentActivity: activity,
  openRecommendations: [stallRecommendation],
};
