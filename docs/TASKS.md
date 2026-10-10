# Hakit — Engineering Task List

Status: **Planning draft v1.** Tasks are sized for one developer or one coding agent, take 1–4h each, and are built against `packages/contracts`.

**Workstreams** (see HACKATHON.md §3):
- **PL**: Platform & backend (auth, workspaces, DB, deploy)
- **IN**: Intelligence (engine, AI services, planning)
- **FE**: Frontend & design system
- **GH**: GitHub, real-time & agents

**Format:** `ID · Title · Priority · Workstream · Est · Depends on`, then acceptance criteria (AC).
**Priority:** P0 = MVP demo path; P1 = differentiator extension; P2 = stretch.
**Definition of done (all tasks):**
- typecheck, lint and tests pass
- Zod-validated at the boundaries
- UI tasks meet the DESIGN §12 checklist
- deployed to preview

## Scaffold status (2026-10-10)

The scaffold commit delivered the following. Remaining work for a partial task is listed under it.

| Task | Status | Remaining |
|---|---|---|
| T-001 Monorepo | ✅ done | – |
| T-002 Bindings | 🟡 config written | Create the Hyperdrive config + queues; put the real Hyperdrive id in `wrangler.jsonc` (SETUP §3) |
| T-003 DB package | 🟡 schema + migrations written | Run them on Tiger dev. `0001_init.sql` passed on plain Postgres 16; `0002_timescale.sql` is untested on TimescaleDB |
| T-004 Contracts v1 | ✅ done | Freeze at C1 after the team reviews it |
| T-005 Seeds | 🟡 286 skills, 1,678 dependency mappings, Knight Hacks IX template | Taxonomy embeddings (embed.batch job); verify challenges on Devpost |
| T-006 GitHub Apps | ⬜ manual | SETUP §4 |
| T-007 CI/CD | 🟡 check, approval-gated migrate, deploy (no preview env, so no PR previews) | Add required reviewers + `DATABASE_URL` secret to the `migrations` environment |
| T-008 Deep health | 🟡 DO, DB, queue, GitHub App JWT, Gemini, HF embed checks | Run against prod; record ARCHITECTURE §13 results in RISKS §4 |
| T-101 Tokens | ✅ done | Sync Figma variables |
| T-104 App shell | 🟡 functional skeleton + routes + placeholders | Real design, inspector, ⌘K |
| T-201 Sign-in & sessions | ✅ OAuth + state cookie, AES-GCM tokens, lazy locked refresh, hashed sessions | Live test against the GitHub App |
| T-202 Workspaces & invites | ✅ templates, invites (expiry, max uses), `requireMember`/`assertOwner` | – |
| T-203 Profile & availability | ✅ GET/PATCH, window validation, `available_hours` | – |
| T-302 API | ✅ hackathon, projects, constraints (challenge refs checked against the workspace template) | FE: S7 screen, fit meter |
| T-308 Plan materialization | ✅ one transaction, HK numbers from the project counter, `embed.batch`, `board.changed` | Re-planning after acceptance (409 today) |
| T-311 API | ✅ accept (locks win), manual assign + lock; board CRUD and cycle-checked dependencies | Solver proposals (T-309, IN) must be stored as `proposed` rows |
| T-502 MC snapshot | ✅ measured progress, lanes (activity_hourly sparkline, agent sessions), blockers, recent activity, open recs | Schedule/health come from T-501 (IN); until then `SCHEDULE_PENDING` |
| T-505 API | ✅ accept applies typed actions in one transaction (reassign, priority/cut, status, split, dependency); dismiss stores a reason | FE: RecommendationCard |
| T-601 Agent tokens | ✅ create (shown once, SHA-256 stored), list/revoke own, `authenticateAgentToken` + `AGENT_RATE_LIMITER` | GH: call it from `/agent/events` (T-602) |
| T-702 Security tests | ✅ authZ matrix over every endpoint (anonymous/non-member/member/owner), CSRF, webhook HMAC, token revocation, log grep + runtime capture; central route guard; log redaction | – |
| T-404 ProjectRoom + WS client | 🟡 DO (hibernation, replay, presence) + `useProjectSocket` implemented | Membership check on upgrade; polling fallback |
| T-603 Claude Code plugin | 🟡 manifest, hooks, minimizing `emit.sh` + test | Marketplace repo; live test |

Also in the scaffold:
- **Mock mode** (`HAKIT_MOCKS=1`): every endpoint serves fixtures.
- The **typed API client** and the **route helper**.
- **Engine stubs**, each naming the task that implements it, plus three helpers that are already implemented: `topoSort`, `cosine`, and `HK-` ref parsing.
- **Provider interfaces** with mocks for LLM, embeddings and GitHub.

---

## Phase 0 — Foundations

**T-001 · Monorepo scaffold** · P0 · PL · 1.5h · –
- AC: pnpm workspace with `apps/web` (Cloudflare vite-react template, Hono), `packages/{contracts,db,engine,ui}`.
- AC: shared tsconfig (strict); ESLint + Prettier; Vitest configured in every package.
- AC: `pnpm dev` serves the SPA and `/api/v1/health`.

**T-002 · Cloudflare bindings & environments** · P0 · PL · 1.5h · T-001
- AC: `wrangler.jsonc` per ARCHITECTURE §4.
- AC: Hyperdrive → Tiger (direct URL); `PROJECT_ROOM` DO with `new_sqlite_classes`; Queue `hakit-jobs` + DLQ; cron; AI binding.
- AC: `.dev.vars.example` lists every secret; `wrangler deploy` succeeds to production.

**T-003 · Tiger Cloud setup & DB package** · P0 · PL · 2h · T-001
- AC: Tiger service created; extensions `timescaledb` and `vector` enabled.
- AC: Drizzle schema for ARCHITECTURE §5; `drizzle-kit` migrations.
- AC: raw SQL migration for the hypertable, the continuous aggregate with its refresh policy, and HNSW indexes.
- AC: `pnpm --filter db migrate` is idempotent.
- AC (optional, demo snapshot): a fork named `hakit-preview` exists.

**T-004 · Contracts v1** · P0 · PL+IN · 3h · T-001
- AC: Zod schemas for every DTO named in ARCHITECTURE §6, plus `WsEvent`, `JobMessage`, `AgentHookEvent`.
- AC: AI output schemas: `IdeaCandidate`, `PlanOutline`, `TaskDraft`, `Feasibility`, `ScoreBreakdown`, `AssignmentExplanation`, `RecommendationDraft`.
- AC: `toGeminiSchema()` (zod-to-json-schema) exports the AI schemas.
- AC: typed API client generated or hand-written in `apps/web/src/client/lib/api.ts`.
- AC: a contract test round-trips fixtures.
- **Contracts freeze at checkpoint C1. Later changes must be additive or agreed with every workstream.**

**T-005 · Seeds** · P0 · IN · 3h · T-003
- AC: skill taxonomy (~250 skills, with categories and aliases) in `packages/db/seed/skills.ts`.
- AC: dependency→skill map (~400 entries) in `packages/engine/capability/dep-map.ts`.
- AC: Knight Hacks IX template: dates, the 5 tracks, judging text. Challenges are marked `verified=false` until confirmed on Devpost.
- AC: taxonomy embeddings computed and stored.

**T-006 · GitHub Apps registration** · P0 · GH · 1h · T-002
- AC: two apps, "Hakit" and "Hakit Dev", with permissions and events per INTEGRATIONS §1.3.
- AC: private key converted to PKCS#8 and stored as a secret.
- AC: prod webhooks reach the deployed worker; local webhook work replays signed fixtures (no tunnel).
- AC: a test delivery reaches the Worker.

**T-007 · CI/CD** · P0 · PL · 1h · T-001
- AC: GitHub Actions runs typecheck, lint and test on PRs.
- AC: deploy on `main`. ~~Preview version upload on PRs~~ (the preview env was removed).
- AC: the migration step is gated on manual approval.

**T-008 · Deep health & verify-list** · P0 · PL · 1h · T-002, T-003
- AC: `/api/v1/health/deep` checks DB (`select time_bucket(...)` through Hyperdrive), DO echo, queue send, GitHub App JWT `GET /app`, Gemini ping and HF embed ping.
- AC: the ARCHITECTURE §13 checklist is resolved and recorded in RISKS.md.

## Phase 1 — Design System

**T-101 · Tokens & Tailwind theme** · P0 · FE · 1.5h · T-001
- AC: `packages/ui/tokens.css` contains all tokens from DESIGN §2–5 as CSS variables plus Tailwind v4 `@theme`.
- AC: contrast check script passes AA for the text tokens.

**T-102 · Primitives** · P0 · FE · 4h · T-101
- AC: Button, IconButton, Input, Textarea, Select, Combobox, TagInput, Dialog, Sheet, Popover, DropdownMenu, Tooltip, Tabs, Toggle, Slider, Avatar, Kbd, Skeleton, EmptyState and ErrorState on Radix.
- AC: every component has focus-visible styles.
- AC: shown in the `/_ui` gallery.

**T-103 · Domain components** · P0 · FE · 4h · T-102, T-004
- AC: StatusBadge, MemberChip/AvatarStack, SkillChip (confirmed/inferred/gap), EvidenceList, ScoreBreakdown, ExplanationCard, RecommendationCard, ActivityItem (confirmed/inferred link), TaskCard/TaskRow, Countdown, ProgressBar (measured plus hatched estimate).
- AC: all props are typed from contracts and render from fixtures.

**T-104 · App shell & routing** · P0 · FE · 3h · T-102
- AC: rail, top bar with workspace switcher and countdown slot, inspector panel (URL-driven `?task=`), mobile bottom tabs, and a ⌘K palette skeleton.
- AC: routes per DESIGN §6 with lazy loading; auth guard.

**T-105 · Figma DS & hi-fi frames** · P0 · FE (designer) · 6h · –
- AC: Figma variables match the tokens.
- AC: hi-fi frames for S11, S9, S8 and S3; wireframes for S1, S2, S4–S7, S10, S12–S14.
- AC: logo concept picked.

**T-106 · Mission Control static mock** · P0 · FE · 3h · T-103, T-104
- AC: S11 rendered from a fixture `MissionControlSnapshot`; serves as both the layout reference and the demo fallback (`?demo=1`).

## Phase 2 — Auth & Team Intelligence

**T-201 · GitHub sign-in & sessions** · P0 · PL · 3h · T-004, T-006
- AC: login, callback and logout implemented; `state` cookie checked.
- AC: user upserted by `github_user_id`; tokens encrypted with AES-GCM.
- AC: lazy refresh with atomic rotation (concurrency-safe via `SELECT … FOR UPDATE`).
- AC: session cookie with the hashed token; `/me`.
- AC: tests cover the state mismatch, expired token refresh and revoked refresh token paths (which force re-login).

**T-202 · Workspaces, invites, membership authZ** · P0 · PL · 3h · T-201
- AC: create workspace with template (sets the deadline).
- AC: invite create, preview and accept (expiry and max uses enforced).
- AC: `requireMember(wid)` middleware; owner-only routes.
- AC: tests prove a non-member gets 404 on every `/w/:wid` route.

**T-203 · Member profile & availability API** · P0 · PL · 2h · T-202
- AC: GET/PATCH profile.
- AC: availability windows validated (inside the event window, no overlaps); `available_hours` derived.

**T-204 · Skill import job** · P0 · IN · 4h · T-005, T-201
- Status: public-repo import route/job, deterministic inference, semantic matching, protected upserts and fixture/in-memory database tests implemented. Project progress broadcasts wired; pre-project onboarding progress requires PL/GH/FE transport coordination. Live 40-repo latency verification remains pending. See `docs/INTELLIGENCE-QA.md` for QA and implementation limits.
- AC: implements AI.md §A.2: GraphQL repo fetch, manifest fetch, deterministic map, semantic match, evidence, aggregation.
- AC: progress events are broadcast to the user.
- AC: confirmed and self-added rows are never overwritten.
- AC: unit tests on the mappers and aggregation with fixtures; an import completes in under 30s for 40 repos.

**T-205 · Embedding service** · P0 · IN · 2h · T-004
- Status: implemented with provider, cache, fallback/breaker, batch-job and health-probe tests. Live HF Qwen3 1024-dimensional embedding and a small semantic matching example verified; live AMD/Workers AI and Tiger/Queue deployment verification remain pending. See `docs/EMBEDDING-VERIFICATION.md`.
- AC: `EmbeddingProvider` implementations for the HF router, OpenAI-compatible (AMD) and Workers AI, all using the same model and dimension.
- AC: content-hash cache, circuit breaker, Qwen3 query instruction prefix.
- AC: test that the fallback produces 1024-dim vectors.

**T-206 · Capability API** · P0 · IN · 2h · T-204
- Status: implemented on `t-206-capability-api`, based on T-204/T-205. Real skill/evidence reads, protected self-edits/removal reports, literal/alias search with optional semantic fallback, and deterministic coverage/availability calculations tested with fixtures and isolated WASM Postgres. UI integration and deployed verification remain pending. See `docs/CAPABILITY-VERIFICATION.md`.
- AC: member skills with evidence; skill upsert and delete (delete stores a negative report); taxonomy search.
- AC: `/capability` computes coverage, bus factor, overlaps, availability curve and effective hours (AI.md §A.3), with an engine unit test.

**T-207 · Onboarding & invite UI (S1, S2)** · P0 · FE · 3h · T-104, T-202
- AC: sign-in page; create-workspace flow with the template picker.
- AC: invite panel with a copy link and QR code; live join presence.
- AC: invite landing page for signed-out users.

**T-208 · Skill import & profile UI (S3, S4)** · P0 · FE · 4h · T-103, T-206
- AC: streaming import checklist; grouped SkillChips with evidence expanders.
- AC: confirm, adjust and remove skills; add a skill via the combobox.
- AC: availability timeline editor; profile tabs.

**T-209 · Team capability UI (S5)** · P0 · FE · 3h · T-206
- AC: CapabilityMatrix, coverage bars, gap and overlap callouts, availability area chart (following the dataviz guidance), and a CTA to planning.

## Phase 3 — Planning & Assignment

**T-301 · LLM provider layer** · P0 · IN · 2h · T-004
- Status: Gemini REST generation/streaming, Zod revalidation with one repair retry, optional AMD JSON-schema provider, cached provider router with circuit breakers/backoff and safe metadata logging implemented. 37 fake-provider tests; opt-in live Gemini generation/streaming check passed with the locally configured model/key. Live AMD and full planning-schema verification remain pending. See `docs/LLM-VERIFICATION.md`.
- AC: `GeminiProvider.generateStructured` with `responseJsonSchema`, `thinkingLevel` and streaming.
- AC: Zod re-validation with one repair retry.
- AC: OpenAI-compatible provider; router with circuit breakers; call logging.
- AC: mock provider for tests.

**T-302 · Constraint selection (S7) + API** · P0 · PL+FE · 3h · T-005, T-104
- AC: challenge catalog cards, required and excluded tech, judging weights.
- AC: pinned constraints panel; fit meter (deterministic coverage of the required tech).

**T-303 · Idea generation & refinement** · P0 · IN · 3h · T-301, T-206
- Status: implemented on `t-303-idea-generation` in an isolated checkout. Pseudonymized server context, remaining availability, deterministic stack coverage, saved manual/generated/refined ideas and validated SSE events tested without live providers. 22 API/context tests and 6 engine tests; Frontend/live idea-quality verification remain pending. See `docs/IDEA-VERIFICATION.md`.
- AC: `PlanningContext` builder with pseudonymized members.
- AC: SSE endpoint streams 3 `IdeaCandidate`s; deterministic `team_fit` = coverage of the idea's stack skills.
- AC: refine endpoint; ideas persisted.

**T-304 · Idea UI (S6)** · P0 · FE · 3h · T-303
- AC: two entry cards; streaming comparison columns showing team fit, challenges, complexity and why this team.
- AC: pick, refine and regenerate one.

**T-305 · Plan generation pipeline** · P0 · IN · 4h · T-303
- AC: outline call, then per-epic task calls in parallel (concurrency 3), streamed as `PlanStreamEvent`s.
- AC: required-deliverable tasks injected; plan versioned and stored.
- AC: template-plan fallback when the provider is unavailable.

**T-306 · Plan validators** · P0 · IN · 3h · T-004
- Status: earlier validator implementation restored on `t-301-306-ai-providers-and-plan-validation`; duplicate epic/milestone references and invalid team effective levels additionally guarded. 40 tests and 100% validator branch coverage. Pipeline integration remains T-305. See `docs/PLAN-VALIDATION.md`.
- AC: AI.md §B.3 checks 1–8 as pure functions returning `Feasibility` (issues with codes and the numbers involved) and automatic cut-line adjustment.
- AC: 100% branch coverage on the cycle, capacity and coverage checks.

**T-307 · Plan review UI (S8)** · P0 · FE · 4h · T-305, T-306
- AC: sections stream in; feasibility banner shows the numbers.
- AC: inline edits produce `PlanPatch`; regenerate section; version switcher; accept.

**T-308 · Plan materialization** · P0 · PL · 2h · T-305
- AC: accept runs in one transaction creating milestones, tasks with HK numbers and dependencies.
- AC: `embed.batch` enqueued; board returned; DO broadcasts `board.changed`.

**T-309 · Assignment solver** · P0 · IN · 4h · T-206, T-004
- AC: AI.md §C.1–C.2: relevance, hard constraints, greedy plus local search, top-2 alternatives, reason codes.
- AC: deterministic for the same input; under 200ms for 6×60.
- AC: property tests: no capacity violation, locks respected, avoid list honoured.

**T-310 · Explanations** · P0 · IN · 1.5h · T-309, T-301
- AC: deterministic templates from reason codes.
- AC: optional batch polish (fast model) constrained to the facts, with the deterministic fallback.

**T-311 · Assignment API & review UI (S9)** · P0 · PL+FE · 4h · T-309, T-103
- AC: solve, accept, manual assign and lock endpoints.
- AC: lanes with capacity bars; explanation inspector; override shows the solver delta; rebalance respects locks.

**T-312 · Task board & inspector (S10)** · P0 · FE+PL · 5h · T-308
- AC: board, list and graph (`@xyflow/react` with dagre) views; drag status (keyboard-accessible).
- AC: inspector tabs; task CRUD; dependency edit with a 409 on cycles.
- AC: copy branch name `hk-12-slug`; optimistic updates.

## Phase 4 — GitHub & Activity

**T-401 · Webhook endpoint** · P0 · GH · 2h · T-006, T-003
- Status: implemented and locally tested (19 focused tests); live GitHub/DB/Queue verification, preview deployment and the under-1s latency check remain pending setup.
- AC: HMAC verification on the raw body (constant time); delivery-ID dedupe; enqueue; 202 in under 1s.
- AC: tests cover a bad signature (401), a duplicate delivery (200, no second job) and an unknown event (202, ignored).
- Implementation: delivery claim and queue send run inside a DB transaction; queue failure rolls back the claim. Queue send and DB commit are not atomic across services, so T-403 must remain idempotent (including duplicate jobs after a commit failure).

**T-402 · Installation & repo discovery** · P0 · GH · 3h · T-201, T-401
- Status: implemented and locally tested (50 focused tests); live verification and preview deployment depend on T-006, T-201 and Platform bindings. See [GITHUB-VERIFICATION](GITHUB-VERIFICATION.md) for checks you can run without coding.
- AC: install URL with state; Setup URL handler verifies the installation through `GET /user/installations`.
- AC: repo list API; `installation*` and `repository` events keep tables in sync; connect-repo endpoint.
- Implementation: short-lived signed state cookie bound to user/workspace; paginated user-token discovery; project-membership and GitHub-access checks before transactional connection; post-commit `github.backfill` enqueue (processor remains T-405). Lifecycle jobs synchronize metadata and detach revoked repos; activity fanout excludes detached/suspended installations. Uses the existing schema; AES-GCM token helpers document the T-201 storage envelope, and expired tokens require reauthentication until Platform adds lazy refresh. Repository picker UI remains T-407.

**T-403 · Event normalization & attribution** · P0 · GH · 3h · T-401
- Status: implemented and locally tested (50 focused tests); live GitHub/DB/Queue/DO verification and preview deployment remain pending setup.
- AC: INTEGRATIONS §1.5 mapping; commits deduped by sha.
- AC: author resolution (ID → noreply parse → alias → unknown).
- AC: insert into the hypertable; DO broadcast `activity.created`.
- AC: fixture-based tests for every event type.
- Implementation: queue handler validates payloads, resolves authors, fans out only to connected projects, stores activity transactionally, broadcasts after commit and marks the delivery processed. Stable activity IDs allow notification retries without duplicate rows; clients may receive the same activity ID again. Commit dedupe uses a transaction-scoped project lock plus a SHA lookup because the existing hypertable index includes the timestamp. PR/review rows leave `sha` null to avoid that index collapsing distinct same-second events; their branch and PR number are retained.
- The real activity endpoint returns the latest 100 events with project-membership checks. Pagination requires a future contract addition. Installation/repository events produce no activity; table synchronization is implemented in T-402. Explicit/semantic task linking remains T-406.

**T-404 · ProjectRoom DO & WS client** · P0 · GH · 3h · T-004
- AC: hibernation accept with membership-checked upgrade; `broadcast` RPC; sequence numbers with a 200-event replay buffer; presence.
- AC: client hook `useProjectSocket` invalidates TanStack queries per event type and falls back to polling after 15s.

**T-405 · Backfill on connect** · P0 · GH · 1.5h · T-402, T-403
- AC: the last 48h of commits, branches and PRs are ingested idempotently.

**T-406 · Activity↔task linking** · P0 · GH+IN · 3h · T-403, T-308, T-205
- AC: AI.md §C.5: confirmed regex (branch, commit, PR) and inferred embedding match with thresholds.
- AC: link kind and confidence stored; manual link endpoint.

**T-407 · Code activity UI (S12)** · P0 · FE · 4h · T-403, T-406
- AC: repo connection panel (install, pick, create via guided URL); feed with filters; branches and PR tables.
- AC: unlinked queue; author mapping; confirmed vs inferred styling.

**T-408 · Redelivery sweep** · P1 · GH · 1.5h · T-401
- AC: cron with the app JWT lists deliveries from the last 3 days and redelivers failures missing from the ledger.

**T-409 · Repo creation via API** · P1 · GH · 2h · T-402, D-4
- AC: only if the Phase 0 verification succeeded: `POST /user/repos` behind an opt-in permission upgrade.

## Phase 5 — Mission Control & Adaptive

**T-501 · Engine: critical path, velocity, health** · P0 · IN · 3h · T-004
- AC: CPM over the DAG with parallelism capped at team size; slack per task.
- AC: rolling velocity; forecast finish (labelled as an estimate).
- AC: health classification with a reason code; unit tests.

**T-502 · Mission Control snapshot API** · P0 · PL · 3h · T-501, T-403
- AC: `MissionControlSnapshot` from the board, the continuous aggregate and agent sessions; p95 under 300ms with demo-size data.

**T-503 · Mission Control UI (S11) live** · P0 · FE · 4h · T-106, T-502, T-404
- AC: replaces the static mock with live data; feed animation; lanes show the current task and last activity; blockers strip; reconnect state.

**T-504 · Adaptive rules v1** · P0 · IN · 4h · T-501, T-309
- AC: stalled task, workload imbalance and critical-path slip (cut scope) rules as pure functions with dedupe keys.
- AC: `recs.evaluate` job on cron and on board change; recommendations expire when their signal clears.
- AC: scenario tests.

**T-505 · Recommendation accept/dismiss** · P0 · PL+FE · 3h · T-504
- AC: typed mutations applied transactionally; board and MC update for all clients.
- AC: RecommendationCard in MC; reassignment animation; dismiss with a reason.

**T-506 · Task status suggestions from PRs** · P1 · GH · 1.5h · T-406
- AC: linked PR opened → in review; linked PR merged → done (auto, with undo toast).

**T-507 · Adaptive rules v2** · P1 · IN · 2h · T-504
- AC: blocked chain, unavailable owner and agent awaiting input rules.

## Phase 6 — Agents (P1)

**T-601 · Agent tokens & privacy** · P1 · PL · 2h · T-202
- AC: create (shown once), list, revoke; hashed storage; per-token sharing flags; rate limit.

**T-602 · Agent ingestion & session state machine** · P1 · GH · 3h · T-601, T-404
- AC: `/agent/events` validated and enqueued; state transitions per INTEGRATIONS §6.1; idle and ended timeouts via cron; session↔task link by branch, else the in-progress task (inferred).

**T-603 · Claude Code plugin** · P1 · GH · 3h · T-602
- AC: `packages/agent-plugin` contains `.claude-plugin/plugin.json` with `userConfig`, `hooks/hooks.json` with async command hooks, and `scripts/emit.sh` (jq minimization, 3s timeout, never fails).
- AC: marketplace repo; a fallback `settings.local.json` installer.
- AC: tested manually with a live session.

**T-604 · Agents UI (S13) + MC dots** · P1 · FE · 3h · T-602, T-103
- AC: setup panel with install command and token; session grid; status dots in Mission Control lanes; confirm-link action.

**T-605 · Codex adapter** · P2 (P1 if D-10) · GH · 2h · T-602
- AC: `hooks.json` / `notify` config mapping onto the same events endpoint.

## Phase 7 — Quality & Submission

**T-701 · E2E happy path** · P0 · PL · 3h · most P0
- AC: Playwright with mocked GitHub OAuth (test login route enabled only in preview with a secret).
- AC: covers onboarding, plan with a mocked provider, assign, a simulated webhook, MC update and accepting a recommendation.

**T-702 · Security tests** · P0 · PL · 2h · T-202, T-401, T-601
- AC: authZ matrix test (non-member, member, owner) over all routes; webhook signature tests; agent token revocation; no secrets in logs (grep test).

**T-703 · AI planning evals** · P1 · IN · 2h · T-305, T-306
- AC: fixture teams × ideas script reporting schema, DAG and coverage pass rates.
- AC: the "same idea, different team" assertion passes.

**T-704 · Responsive & a11y pass** · P0 · FE · 3h · all FE
- AC: axe reports no critical issues on S1–S14; 375px layouts verified; reduced-motion verified.

**T-705 · Demo kit** · P0 · all · 3h · –
- AC: seed script for the demo workspace on a Tiger fork; `scripts/demo-push.sh` creates scripted commits on `hk-*` branches.
- AC: stall scenario switch (set a task's `started_at` back 2h); recorded backup video; pre-demo checklist.

**T-706 · Submission assets** · P0 · all · 2h · –
- AC: Devpost text, architecture diagram, screenshots, Figma link, sponsor paragraphs, README with setup instructions.

## P2 backlog (unscheduled)
- T-801 ElevenLabs mission briefing (Mission Control button → script → TTS → R2 → player).
- T-802 Voice standup (Scribe → structured updates).
- T-803 Auto-drafted Devpost description and submission checklist.
- T-804 Cross-agent conflict detection (same files or branches across sessions).
- T-805 GitHub Issues sync.
- T-806 Capability radar and graph visualization.
- T-807 Historical analytics (continuous aggregates over longer windows).
- T-808 Light theme.
