/**
 * Hakit Postgres schema (docs/ARCHITECTURE.md §5). Tiger Cloud: TimescaleDB + pgvector.
 * TimescaleDB-specific objects (hypertable, continuous aggregate, HNSW indexes) live in the
 * custom SQL migration drizzle/0002_timescale.sql because Drizzle can't express them.
 *
 * Ownership: PL owns this file. Other workstreams request changes via PR to PL (CLAUDE.md).
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';

export const EMBED_DIM = 1024;

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => 'bytea',
  toDriver: (v) => Buffer.from(v),
  fromDriver: (v) => new Uint8Array(v),
});

const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const ts = (name: string) => timestamp(name, { withTimezone: true });
const ghId = (name: string) => bigint(name, { mode: 'number' });
const embedding = () => vector('embedding', { dimensions: EMBED_DIM });

/* ---------------------------------- enums ---------------------------------- */
export const roleEnum = pgEnum('role', ['owner', 'member']);
export const skillCategoryEnum = pgEnum('skill_category', [
  'frontend',
  'backend',
  'data',
  'ml_ai',
  'infra_devops',
  'mobile',
  'design_ux',
  'hardware_embedded',
  'game',
  'security',
  'product_pitch',
]);
export const skillSourceEnum = pgEnum('skill_source', [
  'inferred',
  'confirmed',
  'self_added',
  'task_history',
  'removed',
]);
export const evidenceKindEnum = pgEnum('evidence_kind', [
  'repo_language',
  'manifest_dependency',
  'repo_topic',
  'readme_semantic',
  'contribution',
  'self_report',
  'completed_task',
]);
export const projectStatusEnum = pgEnum('project_status', ['ideating', 'planning', 'active', 'submitted']);
export const constraintKindEnum = pgEnum('constraint_kind', [
  'challenge',
  'required_tech',
  'excluded_tech',
  'judging',
  'custom',
]);
export const ideaSourceEnum = pgEnum('idea_source', ['user', 'ai']);
export const planStatusEnum = pgEnum('plan_status', ['draft', 'accepted', 'superseded']);
export const taskStatusEnum = pgEnum('task_status', [
  'todo',
  'in_progress',
  'in_review',
  'blocked',
  'done',
  'cut',
]);
export const priorityEnum = pgEnum('priority', ['must', 'should', 'could']);
export const taskSourceEnum = pgEnum('task_source', ['plan', 'manual', 'recommendation']);
export const depKindEnum = pgEnum('dependency_kind', ['blocks', 'soft']);
export const assignmentStatusEnum = pgEnum('assignment_status', [
  'proposed',
  'active',
  'replaced',
  'rejected',
]);
export const assignmentSourceEnum = pgEnum('assignment_source', ['solver', 'manual', 'recommendation']);
export const recKindEnum = pgEnum('recommendation_kind', [
  'reassign',
  'split_task',
  'cut_scope',
  'unblock',
  'rebalance',
  'add_dependency',
  'check_in',
]);
export const recStatusEnum = pgEnum('recommendation_status', ['open', 'accepted', 'dismissed', 'expired']);
export const severityEnum = pgEnum('severity', ['info', 'warn', 'critical']);
export const repoSelectionEnum = pgEnum('repository_selection', ['all', 'selected']);
export const aliasKindEnum = pgEnum('alias_kind', ['email', 'login', 'noreply']);
export const activitySourceEnum = pgEnum('activity_source', ['github', 'agent', 'hakit']);
export const linkKindEnum = pgEnum('link_kind', ['confirmed', 'inferred', 'none']);
export const agentKindEnum = pgEnum('agent_kind', ['claude_code', 'codex', 'other']);
export const agentStatusEnum = pgEnum('agent_status', ['active', 'idle', 'awaiting_input', 'ended', 'error']);
export const embedKindEnum = pgEnum('member_embedding_kind', ['profile', 'interests']);

/* --------------------------- identity & teams (§5.1) --------------------------- */
export const users = pgTable('users', {
  id: id(),
  githubUserId: ghId('github_user_id').notNull().unique(),
  githubLogin: text('github_login').notNull(),
  name: text('name'),
  avatarUrl: text('avatar_url'),
  email: text('email'),
  createdAt: createdAt(),
  lastSeenAt: ts('last_seen_at'),
});

export const githubTokens = pgTable('github_tokens', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  accessTokenEnc: bytea('access_token_enc').notNull(),
  refreshTokenEnc: bytea('refresh_token_enc'),
  accessExpiresAt: ts('access_expires_at'),
  refreshExpiresAt: ts('refresh_expires_at'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
  /** SHA-256 of the cookie token, hex. */
  id: text('id').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: ts('expires_at').notNull(),
  createdAt: createdAt(),
  userAgent: text('user_agent'),
});

export const hackathonTemplates = pgTable('hackathon_templates', {
  id: id(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  startsAt: ts('starts_at').notNull(),
  endsAt: ts('ends_at').notNull(),
  timezone: text('timezone').notNull(),
  tracks: jsonb('tracks').notNull().default([]),
  judgingCriteria: jsonb('judging_criteria').notNull().default([]),
  sourceUrl: text('source_url'),
  verifiedAt: ts('verified_at'),
});

export const challenges = pgTable(
  'challenges',
  {
    id: id(),
    hackathonTemplateId: uuid('hackathon_template_id')
      .notNull()
      .references(() => hackathonTemplates.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    sponsor: text('sponsor').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    requirements: text('requirements')
      .array()
      .notNull()
      .default(sql`'{}'`),
    requiredTech: text('required_tech')
      .array()
      .notNull()
      .default(sql`'{}'`),
    prize: text('prize'),
    url: text('url'),
    verified: boolean('verified').notNull().default(false),
  },
  (t) => [uniqueIndex('challenges_template_key').on(t.hackathonTemplateId, t.key)],
);

export const workspaces = pgTable('workspaces', {
  id: id(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  hackathonTemplateId: uuid('hackathon_template_id').references(() => hackathonTemplates.id),
  startsAt: ts('starts_at'),
  deadlineAt: ts('deadline_at').notNull(),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: createdAt(),
});

export const memberships = pgTable(
  'memberships',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: roleEnum('role').notNull().default('member'),
    colorIndex: smallint('color_index').notNull().default(0),
    joinedAt: ts('joined_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })],
);

export const invites = pgTable('invites', {
  id: id(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  code: text('code').notNull().unique(),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  expiresAt: ts('expires_at').notNull(),
  maxUses: integer('max_uses'),
  uses: integer('uses').notNull().default(0),
  revokedAt: ts('revoked_at'),
  createdAt: createdAt(),
});

/* -------------------------- capability intelligence (§5.2) -------------------------- */
export const skills = pgTable('skills', {
  id: id(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  category: skillCategoryEnum('category').notNull(),
  aliases: text('aliases')
    .array()
    .notNull()
    .default(sql`'{}'`),
  related: text('related')
    .array()
    .notNull()
    .default(sql`'{}'`),
  /** Unknown skills proposed by inference/self-entry await normalization. */
  pendingReview: boolean('pending_review').notNull().default(false),
  embedding: embedding(),
});

export const memberProfiles = pgTable(
  'member_profiles',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    headline: text('headline'),
    timezone: text('timezone').notNull().default('America/New_York'),
    interests: text('interests')
      .array()
      .notNull()
      .default(sql`'{}'`),
    learningGoals: text('learning_goals')
      .array()
      .notNull()
      .default(sql`'{}'`),
    avoid: text('avoid')
      .array()
      .notNull()
      .default(sql`'{}'`),
    availability: jsonb('availability').notNull().default([]),
    availableHours: numeric('available_hours', { mode: 'number' }).notNull().default(0),
    onboardingCompletedAt: ts('onboarding_completed_at'),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })],
);

/** User-level (portable across workspaces). Inference never overwrites confirmed/self_added/removed rows. */
export const memberSkills = pgTable(
  'member_skills',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    level: smallint('level').notNull(),
    confidence: real('confidence').notNull(),
    source: skillSourceEnum('source').notNull(),
    confirmedAt: ts('confirmed_at'),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('member_skills_user_skill').on(t.userId, t.skillId)],
);

export const skillEvidence = pgTable(
  'skill_evidence',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    kind: evidenceKindEnum('kind').notNull(),
    sourceRef: text('source_ref').notNull(),
    url: text('url'),
    weight: real('weight').notNull(),
    summary: text('summary').notNull(),
    detail: jsonb('detail'),
    observedAt: ts('observed_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('skill_evidence_user').on(t.userId)],
);

export const memberEmbeddings = pgTable(
  'member_embeddings',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    kind: embedKindEnum('kind').notNull(),
    embedding: embedding().notNull(),
    model: text('model').notNull(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.workspaceId, t.kind] })],
);

/** Content-hash cache so identical texts are embedded once per model. */
export const embeddingCache = pgTable(
  'embedding_cache',
  {
    hash: text('hash').notNull(),
    model: text('model').notNull(),
    embedding: embedding().notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.hash, t.model] })],
);

/* ----------------------------- catalog & projects (§5.3) ----------------------------- */
export const projects = pgTable('projects', {
  id: id(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  pitch: text('pitch'),
  status: projectStatusEnum('status').notNull().default('ideating'),
  repoId: ghId('repo_id'),
  currentPlanId: uuid('current_plan_id'),
  /** Per-project counter for HK-<n> task keys. */
  nextTaskNumber: integer('next_task_number').notNull().default(1),
  createdAt: createdAt(),
});

export const projectConstraints = pgTable('project_constraints', {
  id: id(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  kind: constraintKindEnum('kind').notNull(),
  refId: uuid('ref_id'),
  value: text('value').notNull(),
  weight: real('weight').notNull().default(1),
});

export const ideas = pgTable('ideas', {
  id: id(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  pitch: text('pitch').notNull(),
  payload: jsonb('payload').notNull(),
  teamFit: real('team_fit').notNull().default(0),
  source: ideaSourceEnum('source').notNull(),
  selected: boolean('selected').notNull().default(false),
  createdAt: createdAt(),
});

export const plans = pgTable(
  'plans',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    status: planStatusEnum('status').notNull().default('draft'),
    payload: jsonb('payload').notNull(),
    feasibility: jsonb('feasibility').notNull(),
    model: text('model').notNull(),
    promptHash: text('prompt_hash'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('plans_project_version').on(t.projectId, t.version),
    index('plans_prompt_hash').on(t.promptHash),
  ],
);

/* ---------------------------------- execution (§5.4) ---------------------------------- */
export const milestones = pgTable('milestones', {
  id: id(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  planId: uuid('plan_id').references(() => plans.id),
  title: text('title').notNull(),
  ordinal: integer('ordinal').notNull(),
  targetAt: ts('target_at'),
  description: text('description'),
});

export const tasks = pgTable(
  'tasks',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    milestoneId: uuid('milestone_id').references(() => milestones.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    acceptanceCriteria: text('acceptance_criteria')
      .array()
      .notNull()
      .default(sql`'{}'`),
    labels: text('labels')
      .array()
      .notNull()
      .default(sql`'{}'`),
    status: taskStatusEnum('status').notNull().default('todo'),
    priority: priorityEnum('priority').notNull().default('should'),
    estimateHours: numeric('estimate_hours', { mode: 'number' }).notNull().default(2),
    /** [{skillSlug, level, weight}] — contracts TaskRequiredSkill[] */
    requiredSkills: jsonb('required_skills').notNull().default([]),
    embedding: embedding(),
    source: taskSourceEnum('source').notNull().default('manual'),
    startedAt: ts('started_at'),
    completedAt: ts('completed_at'),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('tasks_project_number').on(t.projectId, t.number),
    index('tasks_project_status').on(t.projectId, t.status),
  ],
);

export const taskDependencies = pgTable(
  'task_dependencies',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    dependsOnTaskId: uuid('depends_on_task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    kind: depKindEnum('kind').notNull().default('blocks'),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.dependsOnTaskId] })],
);

export const assignments = pgTable(
  'assignments',
  {
    id: id(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: assignmentStatusEnum('status').notNull().default('proposed'),
    source: assignmentSourceEnum('source').notNull(),
    locked: boolean('locked').notNull().default(false),
    score: real('score').notNull(),
    breakdown: jsonb('breakdown').notNull(),
    reasonCodes: text('reason_codes')
      .array()
      .notNull()
      .default(sql`'{}'`),
    explanation: text('explanation').notNull(),
    explanationSource: text('explanation_source').notNull().default('template'),
    alternatives: jsonb('alternatives').notNull().default([]),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('assignments_task').on(t.taskId),
    uniqueIndex('assignments_one_active_per_task')
      .on(t.taskId)
      .where(sql`status = 'active'`),
  ],
);

export const recommendations = pgTable(
  'recommendations',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    kind: recKindEnum('kind').notNull(),
    status: recStatusEnum('status').notNull().default('open'),
    severity: severityEnum('severity').notNull(),
    headline: text('headline').notNull(),
    rationale: text('rationale').notNull(),
    impact: jsonb('impact').notNull().default({}),
    actions: jsonb('actions').notNull(),
    signals: jsonb('signals').notNull().default([]),
    dedupeKey: text('dedupe_key').notNull(),
    createdAt: createdAt(),
    resolvedAt: ts('resolved_at'),
    resolvedBy: uuid('resolved_by').references(() => users.id),
    /** Free-text reason from dismiss (T-505); input for rule tuning. */
    dismissReason: text('dismiss_reason'),
  },
  (t) => [
    uniqueIndex('recommendations_open_dedupe')
      .on(t.projectId, t.dedupeKey)
      .where(sql`status = 'open'`),
  ],
);

export const taskEvents = pgTable(
  'task_events',
  {
    id: id(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    kind: text('kind').notNull(),
    fromValue: text('from_value'),
    toValue: text('to_value'),
    at: ts('at').notNull().defaultNow(),
  },
  (t) => [index('task_events_task').on(t.taskId, t.at)],
);

/* ----------------------------- github & activity (§5.5) ----------------------------- */
export const githubInstallations = pgTable('github_installations', {
  id: ghId('id').primaryKey(),
  accountLogin: text('account_login').notNull(),
  accountType: text('account_type').notNull(),
  repositorySelection: repoSelectionEnum('repository_selection').notNull(),
  suspendedAt: ts('suspended_at'),
  createdByUserId: uuid('created_by_user_id').references(() => users.id),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const repos = pgTable('repos', {
  id: ghId('id').primaryKey(),
  installationId: ghId('installation_id').references(() => githubInstallations.id, { onDelete: 'set null' }),
  fullName: text('full_name').notNull(),
  defaultBranch: text('default_branch').notNull().default('main'),
  private: boolean('private').notNull().default(false),
  htmlUrl: text('html_url').notNull(),
  archived: boolean('archived').notNull().default(false),
  pushedAt: ts('pushed_at'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const projectRepos = pgTable(
  'project_repos',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    repoId: ghId('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    connectedBy: uuid('connected_by').references(() => users.id),
    connectedAt: ts('connected_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.repoId] }), index('project_repos_repo').on(t.repoId)],
);

/** Idempotency ledger for GitHub deliveries (X-GitHub-Delivery). */
export const webhookDeliveries = pgTable('webhook_deliveries', {
  deliveryId: text('delivery_id').primaryKey(),
  event: text('event').notNull(),
  action: text('action'),
  installationId: ghId('installation_id'),
  receivedAt: ts('received_at').notNull().defaultNow(),
  processedAt: ts('processed_at'),
  error: text('error'),
});

export const authorAliases = pgTable('author_aliases', {
  emailOrLogin: text('email_or_login').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  kind: aliasKindEnum('kind').notNull(),
  confirmed: boolean('confirmed').notNull().default(false),
});

/**
 * HYPERTABLE on `ts` (see drizzle/0002_timescale.sql). Composite PK must include the time column.
 * Dedupe of commits across push + PR webhooks is enforced by activity_events_commit_dedupe.
 */
export const activityEvents = pgTable(
  'activity_events',
  {
    id: uuid('id')
      .notNull()
      .default(sql`gen_random_uuid()`),
    ts: ts('ts').notNull(),
    projectId: uuid('project_id').notNull(),
    source: activitySourceEnum('source').notNull(),
    kind: text('kind').notNull(),
    actorUserId: uuid('actor_user_id'),
    actorRaw: text('actor_raw'),
    repoId: ghId('repo_id'),
    ref: text('ref'),
    sha: text('sha'),
    prNumber: integer('pr_number'),
    taskId: uuid('task_id'),
    linkKind: linkKindEnum('link_kind').notNull().default('none'),
    linkConfidence: real('link_confidence'),
    title: text('title').notNull(),
    url: text('url'),
    additions: integer('additions'),
    deletions: integer('deletions'),
    filesChanged: integer('files_changed'),
    agentSessionId: uuid('agent_session_id'),
    payload: jsonb('payload'),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.ts] }),
    index('activity_project_ts').on(t.projectId, t.ts.desc()),
    index('activity_task_ts').on(t.taskId, t.ts.desc()),
    index('activity_actor_ts').on(t.actorUserId, t.ts.desc()),
    uniqueIndex('activity_events_commit_dedupe').on(t.projectId, t.sha, t.kind, t.ts),
  ],
);

/* ---------------------------------- agents (§5.6) ---------------------------------- */
export const agentTokens = pgTable('agent_tokens', {
  id: id(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  sharePrompts: boolean('share_prompts').notNull().default(false),
  sharePaths: boolean('share_paths').notNull().default(true),
  lastUsedAt: ts('last_used_at'),
  revokedAt: ts('revoked_at'),
  createdAt: createdAt(),
});

export const agentSessions = pgTable(
  'agent_sessions',
  {
    id: id(),
    externalSessionId: text('external_session_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    agent: agentKindEnum('agent').notNull(),
    repoFullName: text('repo_full_name'),
    branch: text('branch'),
    cwdHash: text('cwd_hash'),
    status: agentStatusEnum('status').notNull().default('active'),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    linkKind: linkKindEnum('link_kind').notNull().default('none'),
    startedAt: ts('started_at').notNull().defaultNow(),
    lastEventAt: ts('last_event_at').notNull().defaultNow(),
    endedAt: ts('ended_at'),
    summary: jsonb('summary').notNull().default({}),
  },
  (t) => [uniqueIndex('agent_sessions_user_external').on(t.userId, t.externalSessionId)],
);
