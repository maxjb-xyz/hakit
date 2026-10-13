/**
 * Hakit schema for Cloudflare D1 (SQLite), docs/ARCHITECTURE.md §5.
 * SQLite has no enums, arrays, jsonb, uuid or vector types, so the helpers below map them: enums are
 * checked text, arrays and JSON are JSON text, timestamps are integer milliseconds, embeddings are JSON
 * number arrays (similarity is computed in the engine, not the database). The 15-minute activity rollup
 * `activity_hourly` is a plain view created in the migrations.
 */
import { sql } from 'drizzle-orm';
import {
  customType,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const EMBED_DIM = 1024;

/** Current time in ms, evaluated by SQLite so raw inserts get it too. */
const NOW = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/** Encrypted bytes (GitHub tokens) as base64 text: D1 blob round-tripping differs across runtimes. */
const bytes = customType<{ data: Uint8Array; driverData: string }>({
  dataType: () => 'text',
  toDriver: (v) => btoa(String.fromCharCode(...v)),
  fromDriver: (v) => Uint8Array.from(atob(v), (c) => c.charCodeAt(0)),
});

const enumOf = <const T extends readonly [string, ...string[]]>(values: T) =>
  Object.assign((name: string) => text(name, { enum: values as unknown as [T[number], ...T[number][]] }), {
    enumValues: values,
  });
const uuid = (name: string) => text(name);
const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const ts = (name: string) => integer(name, { mode: 'timestamp_ms' });
const createdAt = () => ts('created_at').notNull().default(NOW);
const bool = (name: string) => integer(name, { mode: 'boolean' });
const json = (name: string) => text(name, { mode: 'json' }).$type<unknown>();
const textArray = (name: string) =>
  text(name, { mode: 'json' })
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'`);
const ghId = (name: string) => integer(name);
const embedding = () => text('embedding', { mode: 'json' }).$type<number[]>();

/* ---------------------------------- enums ---------------------------------- */
export const roleEnum = enumOf(['owner', 'member']);
export const skillCategoryEnum = enumOf([
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
export const skillSourceEnum = enumOf(['inferred', 'confirmed', 'self_added', 'task_history', 'removed']);
export const evidenceKindEnum = enumOf([
  'repo_language',
  'manifest_dependency',
  'repo_topic',
  'readme_semantic',
  'contribution',
  'self_report',
  'completed_task',
]);
export const projectStatusEnum = enumOf(['ideating', 'planning', 'active', 'submitted']);
export const constraintKindEnum = enumOf([
  'challenge',
  'required_tech',
  'excluded_tech',
  'judging',
  'custom',
]);
export const ideaSourceEnum = enumOf(['user', 'ai']);
export const planStatusEnum = enumOf(['draft', 'accepted', 'superseded']);
export const taskStatusEnum = enumOf(['todo', 'in_progress', 'in_review', 'blocked', 'done', 'cut']);
export const priorityEnum = enumOf(['must', 'should', 'could']);
export const taskSourceEnum = enumOf(['plan', 'manual', 'recommendation']);
export const depKindEnum = enumOf(['blocks', 'soft']);
export const assignmentStatusEnum = enumOf(['proposed', 'active', 'replaced', 'rejected']);
export const assignmentSourceEnum = enumOf(['solver', 'manual', 'recommendation']);
export const recKindEnum = enumOf([
  'reassign',
  'split_task',
  'cut_scope',
  'unblock',
  'rebalance',
  'add_dependency',
  'check_in',
]);
export const recStatusEnum = enumOf(['open', 'accepted', 'dismissed', 'expired']);
export const severityEnum = enumOf(['info', 'warn', 'critical']);
export const repoSelectionEnum = enumOf(['all', 'selected']);
export const aliasKindEnum = enumOf(['email', 'login', 'noreply']);
export const activitySourceEnum = enumOf(['github', 'agent', 'hakit']);
export const linkKindEnum = enumOf(['confirmed', 'inferred', 'none']);
export const agentKindEnum = enumOf(['claude_code', 'codex', 'other']);
export const agentStatusEnum = enumOf(['active', 'idle', 'awaiting_input', 'ended', 'error']);
export const embedKindEnum = enumOf(['profile', 'interests']);

/* --------------------------- identity & teams (§5.1) --------------------------- */
export const users = sqliteTable('users', {
  id: id(),
  githubUserId: ghId('github_user_id').notNull().unique(),
  githubLogin: text('github_login').notNull(),
  name: text('name'),
  avatarUrl: text('avatar_url'),
  email: text('email'),
  createdAt: createdAt(),
  lastSeenAt: ts('last_seen_at'),
});

export const githubTokens = sqliteTable('github_tokens', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  accessTokenEnc: bytes('access_token_enc').notNull(),
  refreshTokenEnc: bytes('refresh_token_enc'),
  accessExpiresAt: ts('access_expires_at'),
  refreshExpiresAt: ts('refresh_expires_at'),
  updatedAt: ts('updated_at').notNull().default(NOW),
});

/**
 * Settings the app writes about itself, keyed by name: today only `github_app`, the GitHub App created
 * through the manifest flow at /setup. Values are AES-GCM encrypted with TOKEN_ENC_KEY.
 */
export const instanceSettings = sqliteTable('instance_settings', {
  key: text('key').primaryKey(),
  valueEnc: bytes('value_enc').notNull(),
  updatedAt: ts('updated_at').notNull().default(NOW),
});

export const sessions = sqliteTable('sessions', {
  /** SHA-256 of the cookie token, hex. */
  id: text('id').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: ts('expires_at').notNull(),
  createdAt: createdAt(),
  userAgent: text('user_agent'),
});

export const hackathonTemplates = sqliteTable('hackathon_templates', {
  id: id(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  startsAt: ts('starts_at').notNull(),
  endsAt: ts('ends_at').notNull(),
  timezone: text('timezone').notNull(),
  tracks: json('tracks')
    .notNull()
    .default(sql`'[]'`),
  judgingCriteria: json('judging_criteria')
    .notNull()
    .default(sql`'[]'`),
  sourceUrl: text('source_url'),
  verifiedAt: ts('verified_at'),
});

export const challenges = sqliteTable(
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
    requirements: textArray('requirements'),
    requiredTech: textArray('required_tech'),
    prize: text('prize'),
    url: text('url'),
    verified: bool('verified').notNull().default(false),
  },
  (t) => [uniqueIndex('challenges_template_key').on(t.hackathonTemplateId, t.key)],
);

export const workspaces = sqliteTable('workspaces', {
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

export const memberships = sqliteTable(
  'memberships',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: roleEnum('role').notNull().default('member'),
    colorIndex: integer('color_index').notNull().default(0),
    joinedAt: ts('joined_at').notNull().default(NOW),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })],
);

export const invites = sqliteTable('invites', {
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
export const skills = sqliteTable('skills', {
  id: id(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  category: skillCategoryEnum('category').notNull(),
  aliases: textArray('aliases'),
  related: textArray('related'),
  /** Unknown skills proposed by inference/self-entry await normalization. */
  pendingReview: bool('pending_review').notNull().default(false),
  embedding: embedding(),
});

export const memberProfiles = sqliteTable(
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
    interests: textArray('interests'),
    learningGoals: textArray('learning_goals'),
    avoid: textArray('avoid'),
    availability: json('availability')
      .notNull()
      .default(sql`'[]'`),
    availableHours: real('available_hours').notNull().default(0),
    onboardingCompletedAt: ts('onboarding_completed_at'),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })],
);

/** User-level (portable across workspaces). Inference never overwrites confirmed/self_added/removed rows. */
export const memberSkills = sqliteTable(
  'member_skills',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    level: integer('level').notNull(),
    confidence: real('confidence').notNull(),
    source: skillSourceEnum('source').notNull(),
    confirmedAt: ts('confirmed_at'),
    updatedAt: ts('updated_at').notNull().default(NOW),
  },
  (t) => [uniqueIndex('member_skills_user_skill').on(t.userId, t.skillId)],
);

export const skillEvidence = sqliteTable(
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
    detail: json('detail'),
    observedAt: ts('observed_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('skill_evidence_user').on(t.userId)],
);

export const memberEmbeddings = sqliteTable(
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
    updatedAt: ts('updated_at').notNull().default(NOW),
  },
  (t) => [primaryKey({ columns: [t.userId, t.workspaceId, t.kind] })],
);

/** Content-hash cache so identical texts are embedded once per model. */
export const embeddingCache = sqliteTable(
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
export const projects = sqliteTable('projects', {
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

export const projectConstraints = sqliteTable('project_constraints', {
  id: id(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  kind: constraintKindEnum('kind').notNull(),
  refId: uuid('ref_id'),
  value: text('value').notNull(),
  weight: real('weight').notNull().default(1),
});

export const ideas = sqliteTable('ideas', {
  id: id(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  pitch: text('pitch').notNull(),
  payload: json('payload').notNull(),
  teamFit: real('team_fit').notNull().default(0),
  source: ideaSourceEnum('source').notNull(),
  selected: bool('selected').notNull().default(false),
  createdAt: createdAt(),
});

export const plans = sqliteTable(
  'plans',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    status: planStatusEnum('status').notNull().default('draft'),
    payload: json('payload').notNull(),
    feasibility: json('feasibility').notNull(),
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
export const milestones = sqliteTable('milestones', {
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

export const tasks = sqliteTable(
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
    acceptanceCriteria: textArray('acceptance_criteria'),
    labels: textArray('labels'),
    status: taskStatusEnum('status').notNull().default('todo'),
    priority: priorityEnum('priority').notNull().default('should'),
    estimateHours: real('estimate_hours').notNull().default(2),
    /** [{skillSlug, level, weight}] — contracts TaskRequiredSkill[] */
    requiredSkills: json('required_skills')
      .notNull()
      .default(sql`'[]'`),
    embedding: embedding(),
    source: taskSourceEnum('source').notNull().default('manual'),
    startedAt: ts('started_at'),
    completedAt: ts('completed_at'),
    updatedAt: ts('updated_at').notNull().default(NOW),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('tasks_project_number').on(t.projectId, t.number),
    index('tasks_project_status').on(t.projectId, t.status),
  ],
);

export const taskDependencies = sqliteTable(
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

export const assignments = sqliteTable(
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
    locked: bool('locked').notNull().default(false),
    score: real('score').notNull(),
    breakdown: json('breakdown').notNull(),
    reasonCodes: textArray('reason_codes'),
    explanation: text('explanation').notNull(),
    explanationSource: text('explanation_source').notNull().default('template'),
    alternatives: json('alternatives')
      .notNull()
      .default(sql`'[]'`),
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

export const recommendations = sqliteTable(
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
    impact: json('impact')
      .notNull()
      .default(sql`'{}'`),
    actions: json('actions').notNull(),
    signals: json('signals')
      .notNull()
      .default(sql`'[]'`),
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

export const taskEvents = sqliteTable(
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
    at: ts('at').notNull().default(NOW),
  },
  (t) => [index('task_events_task').on(t.taskId, t.at)],
);

/* ----------------------------- github & activity (§5.5) ----------------------------- */
export const githubInstallations = sqliteTable('github_installations', {
  id: ghId('id').primaryKey(),
  accountLogin: text('account_login').notNull(),
  accountType: text('account_type').notNull(),
  repositorySelection: repoSelectionEnum('repository_selection').notNull(),
  suspendedAt: ts('suspended_at'),
  createdByUserId: uuid('created_by_user_id').references(() => users.id),
  updatedAt: ts('updated_at').notNull().default(NOW),
});

export const repos = sqliteTable('repos', {
  id: ghId('id').primaryKey(),
  installationId: ghId('installation_id').references(() => githubInstallations.id, { onDelete: 'set null' }),
  fullName: text('full_name').notNull(),
  defaultBranch: text('default_branch').notNull().default('main'),
  private: bool('private').notNull().default(false),
  htmlUrl: text('html_url').notNull(),
  archived: bool('archived').notNull().default(false),
  pushedAt: ts('pushed_at'),
  updatedAt: ts('updated_at').notNull().default(NOW),
});

export const projectRepos = sqliteTable(
  'project_repos',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    repoId: ghId('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    connectedBy: uuid('connected_by').references(() => users.id),
    connectedAt: ts('connected_at').notNull().default(NOW),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.repoId] }), index('project_repos_repo').on(t.repoId)],
);

/** Idempotency ledger for GitHub deliveries (X-GitHub-Delivery). */
export const webhookDeliveries = sqliteTable('webhook_deliveries', {
  deliveryId: text('delivery_id').primaryKey(),
  event: text('event').notNull(),
  action: text('action'),
  installationId: ghId('installation_id'),
  receivedAt: ts('received_at').notNull().default(NOW),
  processedAt: ts('processed_at'),
  error: text('error'),
});

export const authorAliases = sqliteTable('author_aliases', {
  emailOrLogin: text('email_or_login').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  kind: aliasKindEnum('kind').notNull(),
  confirmed: bool('confirmed').notNull().default(false),
});

/**
 * Activity timeline. The composite PK (id, ts) is kept from the Postgres hypertable layout.
 * Dedupe of commits across push + PR webhooks is enforced by activity_events_commit_dedupe.
 */
export const activityEvents = sqliteTable(
  'activity_events',
  {
    id: uuid('id')
      .notNull()
      .$defaultFn(() => crypto.randomUUID()),
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
    payload: json('payload'),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.ts] }),
    index('activity_project_ts').on(t.projectId, t.ts),
    index('activity_task_ts').on(t.taskId, t.ts),
    index('activity_actor_ts').on(t.actorUserId, t.ts),
    uniqueIndex('activity_events_commit_dedupe').on(t.projectId, t.sha, t.kind, t.ts),
  ],
);

/* ---------------------------------- agents (§5.6) ---------------------------------- */
export const agentTokens = sqliteTable('agent_tokens', {
  id: id(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  sharePrompts: bool('share_prompts').notNull().default(false),
  sharePaths: bool('share_paths').notNull().default(true),
  lastUsedAt: ts('last_used_at'),
  revokedAt: ts('revoked_at'),
  createdAt: createdAt(),
});

export const agentSessions = sqliteTable(
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
    startedAt: ts('started_at').notNull().default(NOW),
    lastEventAt: ts('last_event_at').notNull().default(NOW),
    endedAt: ts('ended_at'),
    summary: json('summary')
      .notNull()
      .default(sql`'{}'`),
  },
  (t) => [uniqueIndex('agent_sessions_user_external').on(t.userId, t.externalSessionId)],
);
