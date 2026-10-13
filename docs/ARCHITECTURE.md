# Hakit — Technical Architecture

Status: **Reference.** Written as the hackathon plan and kept as the description of the system; where it and the code disagree, the code wins. Since then the database moved from Tiger Postgres (Hyperdrive, TimescaleDB, pgvector) to **Cloudflare D1**, and the AI providers from Gemini and Hugging Face to **Workers AI** (Gemini and Hugging Face remain optional fallbacks); sections describing the old stack are historical. Current setup: `docs/SETUP.md`. Research date 2026-10-10. Items marked **(verify)** were unconfirmed at the time; research access to some official docs was proxied through search summaries.

---

## 1. Architecture decision summary

| Concern | Decision | Why (vs. alternatives) |
|---|---|---|
| App shape | **One Cloudflare Worker** serving a **Vite React SPA** (static assets) + **Hono** API under `/api/*` | Scaffolded by `npm create cloudflare@latest -- hakit --template=cloudflare/templates/vite-react-template`. SPA routes are served as assets without invoking the Worker. No SSR needed (authenticated app, no SEO). React Router v7 *framework* mode adds loaders/SSR complexity we don't need; Next.js via OpenNext lags Next releases and has the heaviest build. |
| Client routing/data | React Router v7 (library/data mode) + TanStack Query | Mature, typed, cache + optimistic updates; WebSocket events invalidate queries. |
| Language | TypeScript everywhere; **Zod** schemas shared client/server | One contract package consumed by all agents/devs. |
| Database | **Tiger Cloud (TigerData) Postgres**, free plan service: TimescaleDB + pgvector (+ pgvectorscale) | Sponsor-relevant, real Postgres, hypertables for activity, vectors for skills in the same DB. Free plan: 750 MiB, 2 services, forks. |
| DB access | **Hyperdrive** → Tiger *direct service URL* (not the `tsdb_transaction` pooler) **(verify)**; **Drizzle ORM** on `pg` driver; `nodejs_compat` | Pooled, low-latency connections from Workers; Drizzle is officially documented with Hyperdrive. Avoid double transaction-pooling. |
| Real-time | **Durable Object per project** ("ProjectRoom") using the **WebSocket Hibernation API** | Cheap when idle, single fan-out point, presence. Polling fallback via TanStack Query `refetchInterval` when the socket drops. |
| Background work | **Cloudflare Queues** (one queue `hakit-jobs`, typed messages; same Worker produces + consumes) | Webhook ACK < 1s, then process. Skill import, embeddings, plan post-processing. 15-min consumer wall time. Available on Free since Feb 2026; we use Paid for headroom. |
| Periodic jobs | **Cron Trigger** `*/2 * * * *` → adaptive-engine tick + GitHub failed-delivery redelivery sweep | Simple; no Workflows needed for MVP. |
| AI planning | **Gemini** via `@google/genai` (fetch-based) with JSON-schema structured output, streamed to the client | See AI.md / INTEGRATIONS.md. |
| Embeddings | **Qwen3-Embedding-0.6B** (open-weight, HF Hub) served via **HF Inference Providers** → keyword fallback | Same model/dimension on both paths so vectors stay comparable (see AI.md §2.4). |
| Object storage | **R2 — not used in MVP.** Introduced only for P2 (ElevenLabs audio briefings, plan exports). | Don't add services that don't serve P0. |
| Auth | **GitHub App** user-to-server OAuth web flow; Hakit session cookie | One app for sign-in + installation + webhooks; fine-grained permissions; expiring tokens. |
| Secrets | `wrangler secret put` per environment; `.dev.vars` locally (gitignored) | |
| Plan | **Workers Paid ($5/mo)** | Removes the free plan's 10 ms CPU/request, 50-subrequest and queue-ops ceilings during ingest and demo. Decision D-2. |
| Package mgr / monorepo | **pnpm workspaces** (no Turborepo for MVP) | Minimal tooling. |
| Testing | Vitest + `@cloudflare/vitest-pool-workers` (worker), Vitest (engine), Playwright (E2E) | |
| CI/CD | GitHub Actions: typecheck, lint, test; `wrangler deploy` on `main` → production (no preview environment) | Reproducible deploys. |

**What we deliberately do not use:** separate API server, microservices, Workflows, D1 (we have Postgres), KV (sessions live in Postgres; Hyperdrive caches reads), Vectorize (pgvector suffices at our scale), Pages (Workers static assets supersede it).

## 2. System diagram

```
                    ┌──────────────────────────── Cloudflare ─────────────────────────────┐
 Browser (SPA) ─────┤  Worker "hakit"                                                     │
   │  HTTPS /api/*  │   ├─ static assets (React SPA)                                      │
   │  WSS /api/projects/:id/ws ─► Hono router ─► auth mw ─► route handlers ──┐            │
   │                │   ├─ /webhooks/github ─ verify HMAC ─► Queue.send ──────┼──┐         │
   │                │   ├─ /api/agent/events ─ bearer token ─► Queue.send ────┘  │         │
   │                │   ├─ queue() consumer ◄────────────── hakit-jobs ◄─────────┘         │
   │                │   ├─ scheduled() cron (adaptive tick, redelivery sweep)              │
   │                │   └─ DO ProjectRoom (per project; WS hibernation; broadcast)         │
   │                │        ▲ RPC broadcast(evt) from handlers / consumer / cron          │
   │                │   Hyperdrive ──────────────────────────────┐                        │
   │                └────────────────────────────────────────────┼─────────────────────────┘
   │                                                             ▼
   │                                              Tiger Cloud Postgres (Timescale + pgvector)
   │
 GitHub ──webhooks──► /webhooks/github        Gemini API ◄── planning/recommendation calls
 GitHub REST/GraphQL ◄── installation & user tokens     HF Inference Providers ◄── embeddings/classification
 Claude Code hooks (dev laptops) ──HTTPS──► /api/agent/events
```

## 3. Repository layout

```
hakit/
├─ apps/web/                      # the single deployable Worker
│  ├─ wrangler.jsonc
│  ├─ vite.config.ts              # @cloudflare/vite-plugin + react
│  ├─ src/client/                 # React SPA
│  │  ├─ routes/                  # one folder per screen (S1–S14)
│  │  ├─ features/                # team, planning, tasks, activity, agents, mission-control
│  │  └─ lib/                     # api client (typed from contracts), ws client, query keys
│  └─ src/worker/
│     ├─ index.ts                 # export default { fetch, queue, scheduled }; export { ProjectRoom }
│     ├─ app.ts                   # Hono app composition
│     ├─ routes/                  # auth, workspaces, members, skills, projects, plans, tasks, github, agents, recs
│     ├─ webhooks/github.ts
│     ├─ jobs/                    # queue handlers by message type
│     ├─ cron/                    # adaptive tick, redelivery sweep
│     ├─ do/project-room.ts
│     ├─ services/                # github, ai (provider-agnostic), embeddings, crypto, session
│     └─ db.ts                    # per-request Drizzle client from env.HYPERDRIVE
├─ packages/contracts/            # Zod schemas: API DTOs, WS events, queue messages, AI outputs  ← SHARED CONTRACT
├─ packages/db/                   # Drizzle schema, migrations (drizzle-kit), seed (hackathon templates, skill taxonomy)
├─ packages/engine/               # PURE TS, no I/O: capability scoring, assignment solver, critical path, adaptive rules
├─ packages/ui/                   # tokens.css, Radix-based components (DESIGN.md §7)
├─ packages/agent-plugin/         # Claude Code plugin: hooks/hooks.json + scripts/emit.sh
├─ e2e/                           # Playwright
└─ docs/
```

`packages/engine` is deliberately I/O-free so the solver, critical-path and adaptive rules are unit-testable and can be developed in parallel against fixtures.

## 4. Configuration & environments

`wrangler.jsonc` (sketch):

```jsonc
{
  "name": "hakit",
  "main": "src/worker/index.ts",
  "compatibility_date": "2026-10-01",
  "compatibility_flags": ["nodejs_compat"],
  "assets": { "not_found_handling": "single-page-application", "run_worker_first": ["/api/*", "/webhooks/*"] },
  "hyperdrive": [{ "binding": "HYPERDRIVE", "id": "<id>", "localConnectionString": "postgres://..." }],
  "durable_objects": { "bindings": [{ "name": "PROJECT_ROOM", "class_name": "ProjectRoom" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["ProjectRoom"] }],
  "queues": { "producers": [{ "binding": "JOBS", "queue": "hakit-jobs" }],
              "consumers": [{ "queue": "hakit-jobs", "max_batch_size": 10, "max_retries": 5, "dead_letter_queue": "hakit-dlq" }] },
  "triggers": { "crons": ["*/2 * * * *"] },
  "ai": { "binding": "AI" },
  "vars": { "APP_URL": "https://hakit.<domain>", "GEMINI_MODEL_PLAN": "gemini-flash-latest", "GEMINI_MODEL_FAST": "gemini-flash-lite-latest", "EMBED_MODEL": "Qwen/Qwen3-Embedding-0.6B", "EMBED_DIM": "1024" }
}
```

**Secrets** (`wrangler secret put`): `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` (PKCS#8 — convert with `openssl pkcs8 -topk8 -nocrypt`), `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_WEBHOOK_SECRET`, `SESSION_SECRET`, `TOKEN_ENC_KEY` (AES-GCM 256, base64), `GEMINI_API_KEY`, `HF_TOKEN`, optional `ELEVENLABS_API_KEY`.

**Environments:** `local` (wrangler dev + Tiger fork or local Postgres with timescale/pgvector via Docker), `preview` (Tiger *fork* of prod — a Tiger feature worth showing), `production`. A **second GitHub App** ("Hakit Dev") for local sign-in only (webhooks off; local webhook work replays signed fixtures, no tunnels).

## 5. Data model (Postgres / Drizzle)

Conventions: `id uuid pk default gen_random_uuid()`, `created_at timestamptz default now()`, soft FK cascade on workspace delete. Enums as Postgres enums. Short human IDs for tasks (`HK-12`) via per-project counter.

### 5.1 Identity & teams

```sql
users(id, github_user_id bigint unique, github_login text, name, avatar_url, email,
      created_at, last_seen_at)
github_tokens(user_id pk fk, access_token_enc bytea, refresh_token_enc bytea,
              access_expires_at, refresh_expires_at, updated_at)          -- AES-GCM encrypted
sessions(id text pk /*random 32B, hashed*/, user_id fk, expires_at, created_at, user_agent)
workspaces(id, name, slug unique, hackathon_template_id fk null, deadline_at timestamptz,
           starts_at, created_by fk users, created_at)
memberships(workspace_id fk, user_id fk, role enum('owner','member'), color_index smallint,
            joined_at, primary key(workspace_id, user_id))
invites(id, workspace_id fk, code text unique /*10 chars base32*/, created_by, expires_at,
        max_uses int null, uses int default 0, revoked_at null)
```

### 5.2 Capability intelligence

```sql
skills(id, slug unique /* 'react' */, name, category enum('frontend','backend','data','ml_ai',
       'infra_devops','mobile','design_ux','hardware_embedded','game','security','product_pitch'),
       aliases text[], embedding vector(1024))            -- seeded taxonomy (~250 skills)
member_profiles(workspace_id, user_id, headline, timezone, interests text[],
                learning_goals text[] /* skill slugs */, avoid text[] /* skill slugs */,
                availability jsonb /* [{start,end,kind:'available'|'sleep'|'away'}] */,
                available_hours numeric /* derived */, onboarding_completed_at,
                primary key(workspace_id, user_id))
member_skills(id, user_id, skill_id, level smallint /*1-5*/, confidence real /*0-1*/,
              source enum('inferred','confirmed','self_added','task_history'),
              confirmed_at null, updated_at, unique(user_id, skill_id))
              -- user-level (portable across workspaces); confirmed rows are never overwritten by inference
skill_evidence(id, user_id, skill_id, kind enum('repo_language','manifest_dependency','repo_topic',
               'readme_semantic','contribution','self_report','completed_task'),
               source_ref text /* repo full_name, file, task id */, weight real, detail jsonb,
               observed_at, created_at)
member_embeddings(user_id, workspace_id, kind enum('profile','interests'), embedding vector(1024),
                  model text, updated_at, primary key(user_id, workspace_id, kind))
```

### 5.3 Hackathon catalog & projects

```sql
hackathon_templates(id, slug, name, starts_at, ends_at, timezone, judging_criteria jsonb,
                    tracks jsonb, source_url, verified_at null)
challenges(id, hackathon_template_id, sponsor, title, description, requirements text[],
           required_tech text[] /* skill slugs or product names */, prize text, url, verified boolean)
projects(id, workspace_id, name, pitch, status enum('ideating','planning','active','submitted'),
         repo_id fk null, current_plan_id fk null, created_at)
project_constraints(project_id, kind enum('challenge','required_tech','excluded_tech','judging','custom'),
                    ref_id null, value text, weight real)
ideas(id, project_id, title, pitch, payload jsonb /* IdeaCandidate */, team_fit real,
      source enum('user','ai'), selected boolean, created_at)
plans(id, project_id, version int, status enum('draft','accepted','superseded'),
      payload jsonb /* PlanDocument (contracts) */, feasibility jsonb, model text,
      prompt_hash text, created_by, created_at, unique(project_id, version))
```

### 5.4 Execution

```sql
milestones(id, project_id, plan_id, title, ordinal, target_at, description)
tasks(id, project_id, number int /* HK-<number> */, milestone_id, title, description,
      acceptance_criteria text[], status enum('todo','in_progress','in_review','blocked','done','cut'),
      priority enum('must','should','could'), estimate_hours numeric, required_skills jsonb
      /* [{skill_id, level, weight}] */, embedding vector(1024), started_at, completed_at,
      source enum('plan','manual','recommendation'), updated_at,
      unique(project_id, number))
task_dependencies(task_id, depends_on_task_id, kind enum('blocks','soft'), primary key(task_id, depends_on_task_id))
assignments(id, task_id, user_id, status enum('proposed','active','replaced','rejected'),
            source enum('solver','manual','recommendation'), locked boolean,
            score real, breakdown jsonb /* ScoreBreakdown */, explanation text,
            alternatives jsonb /* [{user_id, score, delta_reason}] */, created_by, created_at)
recommendations(id, project_id, kind enum('reassign','split_task','cut_scope','unblock','rebalance',
                'add_dependency','check_in'), status enum('open','accepted','dismissed','expired'),
                severity enum('info','warn','critical'), headline, rationale, impact jsonb,
                actions jsonb /* typed mutation proposals */, signals jsonb /* evidence */,
                dedupe_key text, created_at, resolved_at, resolved_by,
                unique(project_id, dedupe_key) where status='open')
task_events(id, task_id, actor_user_id null, kind, from_value, to_value, at)   -- audit/history
```

### 5.5 GitHub & activity (TimescaleDB)

```sql
github_installations(id bigint pk /* installation_id */, account_login, account_type,
                     repository_selection enum('all','selected'), suspended_at, created_by_user_id, updated_at)
repos(id bigint pk /* github repo id */, installation_id, full_name, default_branch, private boolean,
      html_url, archived boolean, updated_at)
project_repos(project_id, repo_id, connected_by, connected_at, primary key(project_id, repo_id))
webhook_deliveries(delivery_id uuid pk, event text, action text, installation_id, received_at,
                   processed_at null, error text null)                      -- idempotency ledger
author_aliases(email_or_login text pk, user_id fk, kind enum('email','login','noreply'), confirmed boolean)

activity_events(                                                -- HYPERTABLE on ts (1-day chunks)
  ts timestamptz not null, id uuid, project_id uuid, source enum('github','agent','hakit'),
  kind text /* 'commit','branch_created','branch_deleted','pr_opened','pr_merged','pr_closed',
               'pr_review','agent_session_start','agent_awaiting_input','agent_stop',... */,
  actor_user_id uuid null, actor_raw text /* login/email if unmapped */,
  repo_id bigint null, ref text null, sha text null, pr_number int null,
  task_id uuid null, link_kind enum('confirmed','inferred','none'), link_confidence real null,
  title text, url text, additions int, deletions int, files_changed int,
  agent_session_id uuid null, payload jsonb,
  primary key (id, ts))
-- SELECT create_hypertable('activity_events', by_range('ts', INTERVAL '1 day'));
-- indexes: (project_id, ts desc), (task_id, ts desc), (actor_user_id, ts desc)
-- unique (project_id, sha, kind, ts) for commit dedupe across push + PR webhooks

-- Continuous aggregate powering health, stall detection and charts
CREATE MATERIALIZED VIEW activity_hourly WITH (timescaledb.continuous) AS
  SELECT time_bucket('15 minutes', ts) AS bucket, project_id, actor_user_id, task_id, source, kind,
         count(*) AS n, sum(additions) AS adds, sum(deletions) AS dels
  FROM activity_events GROUP BY 1,2,3,4,5,6;
-- refresh policy every 2 min, materialized_only = false (real-time aggregation)
```

### 5.6 Agent telemetry

```sql
agent_tokens(id, user_id, workspace_id, name, token_hash bytea, last_used_at, revoked_at, created_at,
             share_prompts boolean default false, share_paths boolean default true)
agent_sessions(id uuid, external_session_id text, user_id, workspace_id, project_id null,
               agent enum('claude_code','codex','other'), repo_full_name null, branch null,
               cwd_hash text, status enum('active','idle','awaiting_input','ended','error'),
               task_id null, link_kind enum('confirmed','inferred','none'), started_at, last_event_at,
               ended_at, summary jsonb /* counts by tool */, unique(user_id, external_session_id))
-- raw events go to activity_events with source='agent'
```

### 5.7 Vector indexes

`CREATE INDEX ON skills USING hnsw (embedding vector_cosine_ops);` same for `tasks.embedding`, `member_embeddings.embedding`. Scale is tiny (hundreds of rows); HNSW is plenty (pgvectorscale DiskANN optional, for sponsor showcase only).

## 6. API contracts (REST, JSON, `/api/v1`)

All request/response bodies are Zod schemas exported from `packages/contracts` (names in `code`). Errors: `{ error: { code, message, requestId } }` with standard HTTP codes. Auth: `hakit_session` cookie (HttpOnly, Secure, SameSite=Lax) + `X-Requested-With: hakit` header on mutating requests (CSRF). AuthZ: workspace membership middleware on every `/w/:workspaceId/*` route.

### 6.1 Auth
| Method | Path | Body → Response |
|---|---|---|
| GET | `/auth/github/login?next=` | 302 to GitHub authorize (state cookie) |
| GET | `/auth/github/callback?code&state` | Creates user/session; 302 to `next` |
| GET | `/auth/github/setup?installation_id&setup_action` | Post-install landing; verifies installation via `GET /user/installations`; 302 to repo picker |
| POST | `/auth/logout` | 204 |
| GET | `/me` | → `Me` (user, memberships) |

### 6.2 Workspaces & members
| Method | Path | Contract |
|---|---|---|
| POST | `/workspaces` | `CreateWorkspace` → `Workspace` |
| GET | `/w/:wid` | → `WorkspaceDetail` |
| PATCH | `/w/:wid` | `UpdateWorkspace` (owner) |
| POST | `/w/:wid/invites` | `CreateInvite` → `Invite` (url) |
| GET | `/invites/:code` | → `InvitePreview` (public: workspace name, member avatars) |
| POST | `/invites/:code/accept` | → `Membership` |
| GET | `/w/:wid/members` | → `Member[]` (profile + skills summary + current task) |
| GET/PATCH | `/w/:wid/members/:uid/profile` | `MemberProfile` (self or owner for availability) |

### 6.3 Capability
| Method | Path | Contract |
|---|---|---|
| POST | `/w/:wid/members/me/skills/import` | → `JobAccepted { jobId }` (enqueues `skills.import`) |
| GET | `/w/:wid/members/:uid/skills` | → `MemberSkill[]` with `Evidence[]` |
| PUT | `/me/skills/:skillSlug` | `UpsertMemberSkill { level, confirmed }` |
| DELETE | `/me/skills/:skillSlug` | 204 (records negative self-report so inference won't re-add) |
| GET | `/skills?q=` | → `Skill[]` (taxonomy search; semantic + alias) |
| GET | `/w/:wid/capability` | → `TeamCapability` (coverage, gaps, overlaps, availability curve) |

### 6.4 Planning
| Method | Path | Contract |
|---|---|---|
| GET | `/hackathons/:slug` | → `HackathonTemplate` with `Challenge[]` |
| POST | `/w/:wid/projects` | `CreateProject` → `Project` |
| PUT | `/projects/:pid/constraints` | `ProjectConstraint[]` |
| POST | `/projects/:pid/ideas/generate` | `GenerateIdeas { count, guidance? }` → **SSE stream** of `IdeaCandidate` |
| POST | `/projects/:pid/ideas/:iid/refine` | `RefineIdea { instruction }` → SSE `IdeaCandidate` |
| POST | `/projects/:pid/plans/generate` | `GeneratePlan { ideaId, guidance? }` → **SSE**: `PlanStreamEvent` (`stage`, `section`, `validation`, `done{planId}`) |
| GET | `/projects/:pid/plans/:planId` | → `Plan` (payload `PlanDocument` + `Feasibility`) |
| PATCH | `/projects/:pid/plans/:planId` | `PlanPatch` (JSON-patch-like edits to sections) |
| POST | `/projects/:pid/plans/:planId/regenerate-section` | `{ section, instruction }` → SSE |
| POST | `/projects/:pid/plans/:planId/accept` | Materializes milestones/tasks/deps → `ProjectBoard` |

### 6.5 Tasks & assignment
| Method | Path | Contract |
|---|---|---|
| GET | `/projects/:pid/board` | → `ProjectBoard` (milestones, tasks, deps, active assignments) |
| POST | `/projects/:pid/tasks` | `CreateTask` → `Task` |
| PATCH | `/tasks/:tid` | `UpdateTask` (status, estimate, title, skills, milestone) |
| PUT/DELETE | `/tasks/:tid/dependencies/:depId` | dependency edit (cycle check → 409) |
| POST | `/projects/:pid/assignments/solve` | `SolveRequest { scope:'all'|'unassigned', respectLocks:true }` → `AssignmentProposal` (per-task `Assignment` with `ScoreBreakdown`, explanation, alternatives) |
| POST | `/projects/:pid/assignments/accept` | `{ assignmentIds[] }` → `ProjectBoard` |
| PUT | `/tasks/:tid/assignee` | `ManualAssign { userId, lock }` → `Assignment` (score computed for display, source=manual) |
| GET | `/tasks/:tid/explanation` | → `AssignmentExplanation` |

### 6.6 GitHub
| Method | Path | Contract |
|---|---|---|
| GET | `/github/install-url?workspaceId` | → `{ url }` (App install URL with `state`) |
| GET | `/github/repos` | → `RepoSummary[]` (repos in the user's installations) |
| POST | `/github/repos` | `CreateRepo { name, private, description }` → `RepoSummary` (D-4) |
| POST | `/projects/:pid/repo` | `ConnectRepo { repoId }` → backfills last 48h commits/PRs via job |
| GET | `/projects/:pid/activity?cursor&kind&member&task&linked` | → `Page<ActivityEvent>` |
| POST | `/activity/:eid/link` | `LinkActivity { taskId }` (confirm or change inferred link) |
| POST | `/w/:wid/author-aliases` | `MapAuthor { raw, userId }` |
| POST | `/webhooks/github` | GitHub → 202 (signature verified, deduped, enqueued) |

### 6.7 Mission Control & recommendations
| Method | Path | Contract |
|---|---|---|
| GET | `/projects/:pid/mission-control` | → `MissionControlSnapshot` (countdown, health, progress{measured, estimated}, lanes, criticalPath, blockers, recentActivity, openRecommendations) |
| GET | `/projects/:pid/recommendations?status=open` | → `Recommendation[]` |
| POST | `/recommendations/:rid/accept` | `{ actionIndex?, modifications? }` → applies typed actions transactionally → `ProjectBoard` |
| POST | `/recommendations/:rid/dismiss` | `{ reason? }` |
| GET (WS) | `/projects/:pid/ws` | Upgrade → ProjectRoom DO |

### 6.8 Agents
| Method | Path | Contract |
|---|---|---|
| POST | `/w/:wid/agent-tokens` | `CreateAgentToken { name, sharePrompts, sharePaths }` → `{ token /*shown once*/, installCommand }` |
| DELETE | `/agent-tokens/:id` | revoke |
| POST | `/agent/events` | Bearer agent token; `AgentHookEvent` (minimized Claude Code hook payload) → 202 |
| GET | `/projects/:pid/agent-sessions` | → `AgentSession[]` |
| PATCH | `/agent-sessions/:id` | `{ taskId }` (confirm link) |

## 7. Real-time protocol (ProjectRoom DO)

- Client connects `wss://…/api/v1/projects/:pid/ws`; Worker authenticates session + membership, then forwards to `env.PROJECT_ROOM.get(idFromName(pid))`. DO calls `ctx.acceptWebSocket(ws, [userId])`.
- Server → client message: `WsEvent` discriminated union (`packages/contracts/ws.ts`):
  - `activity.created` { event: ActivityEvent }
  - `task.updated` { task, assignment? }
  - `board.changed` { reason } (client refetches board)
  - `recommendation.created|resolved` { recommendation }
  - `agent_session.updated` { session }
  - `presence` { userIds[] }
  - `plan.progress` { planId, stage }
  - `health.updated` { health }
  - every message: `{ v:1, seq, at, type, data }`; DO keeps last 200 in its SQLite for `resume?since=seq` replay.
- Client → server: `{ type:'hello', lastSeq }`, `{ type:'ping' }`. No mutations over WS (all mutations via REST — single write path).
- Producers call `stub.broadcast(evt)` (DO RPC) *after* the DB commit.
- Fallback: if the socket is closed > 15s, TanStack Query polls `mission-control` every 10s.

## 8. Background jobs (Queue `hakit-jobs`)

`JobMessage` discriminated union (`packages/contracts/jobs.ts`), each with `jobId`, `attempt`:

| type | Producer | Work | Idempotency |
|---|---|---|---|
| `github.webhook` | webhook route | normalize → `activity_events`, update repos/installations, link to task, broadcast | `webhook_deliveries.delivery_id` (insert-on-conflict-do-nothing before processing; mark processed) |
| `github.backfill` | connect repo | last 48h commits/PRs/branches via installation token | upsert by (sha, kind) / pr number |
| `skills.import` | import endpoint | fetch repos/languages/manifests/READMEs → evidence → inference → embeddings | per user; replaces `inferred` rows only |
| `embed.batch` | plan accept / skill change | embed tasks/members | by content hash |
| `activity.link` | webhook job (if no explicit ref) | semantic inference of task link | by event id |
| `agent.event` | agent endpoint | update `agent_sessions`, insert activity, broadcast | (session id, event, ts) |
| `recs.evaluate` | cron / board change | run engine rules → upsert recommendations | `dedupe_key` |

DLQ `hakit-dlq` inspected manually. Each handler is a pure function of (message, deps) for testability.

## 9. Cron (`*/2 * * * *`)

1. For each project with `status='active'` and deadline in the future: enqueue `recs.evaluate`.
2. Every 10th tick: GitHub redelivery sweep — `GET /app/hook/deliveries` (app JWT), redeliver failures from the last 3 days not in `webhook_deliveries` (GitHub does **not** auto-retry).
3. Expire stale invites; mark agent sessions `idle` after 10 min without events, `ended` after 2h.

## 10. Security model

- **Sessions:** random 32-byte token in cookie; only SHA-256 hash stored; 14-day sliding expiry.
- **GitHub tokens:** user access + refresh tokens encrypted with AES-GCM (`TOKEN_ENC_KEY`), refreshed lazily when < 5 min to expiry; rotation stored atomically (old refresh token is invalidated by GitHub). Installation tokens minted on demand (1h), never stored.
- **Webhook:** HMAC-SHA256 over raw body with `crypto.subtle`, constant-time compare, reject before parse; ACK in < 1s.
- **Installation trust:** never trust `installation_id` from the setup redirect alone — verify against `GET /user/installations` for the signed-in user.
- **Authorization:** every project/task/activity query is scoped through `workspace_id` membership; repo connection requires that the user can access the repo via their user token.
- **Agent tokens:** `hk_at_` prefix + 32 random bytes, hash stored, scoped `telemetry:write`, per workspace, revocable; rate limit 20 req/s per token (Workers rate-limiting binding or DO counter).
- **AI data policy:** only public-repo metadata (languages, manifests, topics, README excerpt) is sent to AI providers by default. Private repo content requires explicit per-workspace consent (Settings → Privacy). Commit messages/PR titles of the connected repo are used for task linking; this is disclosed at connect time.
- **Input validation:** Zod on every boundary (HTTP, queue, WS, AI outputs).
- **Logging:** Workers Logs/`console` structured JSON with `requestId`; no tokens or prompt content logged.

## 11. Performance budgets

- Webhook → visible in Mission Control: p95 < 3s (queue latency + DB + DO broadcast).
- Mission Control snapshot API: p95 < 300ms (continuous aggregate + indexed reads).
- Idea generation first token < 3s; full plan < 45s streamed (sections appear progressively).
- Assignment solve (≤ 6 members, ≤ 60 tasks): < 200ms in-Worker (engine is pure TS).
- SPA initial JS < 250KB gz; route-level code splitting.

## 12. Deployment process

1. `pnpm i && pnpm -r typecheck && pnpm -r test`
2. `pnpm --filter db migrate` (drizzle-kit against Tiger via direct URL, not Hyperdrive)
3. `pnpm --filter web build && wrangler deploy` (CI on `main`).
4. Seed: `pnpm --filter db seed` (skill taxonomy + embeddings, Knight Hacks IX template).
5. Smoke test script: health endpoint, DB ping, GitHub App JWT ping, Gemini ping, HF ping, DO WebSocket echo.

## 13. Verify-list (Phase 0, ≤ 1h total)

- [ ] Hyperdrive ↔ Tiger Cloud direct URL works with Drizzle + TimescaleDB extension functions (`time_bucket`) through Hyperdrive.
- [ ] Workers Paid CPU defaults and Free-plan limits as cited.
- [ ] GitHub App user token can `POST /user/repos` (Administration: write) — community reports suggest issues; fallback documented in INTEGRATIONS §1.6.
- [ ] `@google/genai` runs in Workers with `nodejs_compat` (else raw `fetch` to REST).
- [ ] HF Inference Providers model availability for the chosen embedding model (AI.md §2.4).
