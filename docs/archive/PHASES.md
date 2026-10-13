# Hakit — Phased Implementation Plan

Status: **Planning draft v1 — awaiting approval.**

## 0. Dependency-driven ordering (changes from the original outline)

The original phase list is preserved, with three adjustments:

1. **Contracts first.** `packages/contracts` (Zod schemas for DTOs, WS events, jobs and AI outputs) and the DB schema are produced in Phase 0. Every later phase, and every parallel developer or agent, builds against them.
2. **Phases 1–4 overlap.** Design (Phase 1) runs **in parallel** with the backend foundations of Phases 2 and 4. Only *feature UI* waits for the design system; the API, engine and GitHub ingestion do not.
3. **GitHub ingestion starts in Phase 2, not after planning.** It is P0 with external-setup risk (App registration, webhooks to a public URL), so the webhook pipeline is proven by the first integration checkpoint. Activity-to-task linking still lands after tasks exist (Phase 3), as part of Phase 4.
4. **A minimal Adaptive Execution slice (stall → reassign) moves into Phase 5 as demo-critical.** It is the third differentiator and must be shown.

```
Phase 0  Research & Architecture ──► contracts + schema + scaffold + deploy pipeline
           │
           ├──► Phase 1  Design system & screens ────────────────┐ (UI kit gates feature UIs)
           ├──► Phase 2  Auth & Team Intelligence (API + engine) ─┤
           ├──► Phase 4a GitHub App + webhook ingestion ──────────┤
           │                                                       ▼
           │          Phase 3  Planning & Assignment ──► Phase 4b Activity↔Task linking
           │                                                       ▼
           │                                     Phase 5  Mission Control & Adaptive
           │                                                       ▼
           │                                     Phase 6  Coding-agent integration (P1)
           ▼                                                       ▼
                                                 Phase 7  Testing, polish, submission
```

## Phase 0 — Research & Architecture

**Goal:** a deployable hello-world with every binding connected, plus frozen contracts.

| Deliverable | Detail |
|---|---|
| Research | ✅ Done in this planning pass (COMPETITIVE, INTEGRATIONS) |
| Verify-list | ARCHITECTURE §13: Hyperdrive↔Tiger, GitHub repo creation, `@google/genai` on Workers, HF Qwen3 availability |
| Scaffold | pnpm monorepo; `apps/web` from the Cloudflare vite-react template; packages `contracts`, `db`, `engine`, `ui` |
| Infra | Tiger service and fork; Hyperdrive config; Queue + DLQ; DO migration; cron; secrets; GitHub Apps (prod + dev); Workers Paid |
| Contracts v1 | All Zod schemas named in ARCHITECTURE §6–8 and AI.md §B.2, with JSON-schema export for Gemini |
| DB v1 | Drizzle schema for all of §5; hypertable + continuous aggregate SQL migration; seeds (skill taxonomy ~250 with aliases and categories; Knight Hacks IX template; dependency→skill map) |
| CI/CD | GitHub Actions typecheck/lint/test, deploy on main, preview per PR |
| Smoke | `/api/v1/health/deep` checks DB, DO, Queue, GitHub JWT, Gemini, HF |

**Exit criteria:** the production URL serves the SPA; `/health/deep` is all green; a test webhook from the GitHub App is received, verified and stored.

## Phase 1 — Branding, UX & Design System

**Goal:** a unified look before feature UIs multiply.

| Deliverable | Detail |
|---|---|
| Identity | Logo direction picked (DESIGN §1), wordmark, accent colour (D-9) |
| Figma | Variables, core components, hi-fi S11 Mission Control, S9 Assignment review, S8 Plan review, S3 Skill import; wireframes for the rest |
| `packages/ui` | `tokens.css` (Tailwind v4 `@theme`), the primitives in DESIGN §7, built on Radix; a component gallery route `/_ui` (dev only) |
| App shell | Rail/sidebar, top bar with countdown slot, inspector panel, ⌘K palette skeleton, mobile tab bar |
| Patterns | Empty, loading, error and AI-unavailable states; measured/estimated encoding; inferred/confirmed encoding |

**Exit criteria:** the shell and the `/_ui` gallery are deployed; S11 is implemented as a **static mock with fixture data**, which is also the demo fallback.

## Phase 2 — Authentication & Team Intelligence

| Deliverable | Detail |
|---|---|
| Auth | GitHub App web flow, sessions, encrypted tokens with refresh, `/me` |
| Workspaces | Create (with hackathon template), invite links, accept flow, membership authZ middleware |
| Profiles | Availability timeline editor, interests, learning goals, avoid list |
| Skill import | `skills.import` job (AI.md §A.2): fetch, map, embed, aggregate; streamed progress via DO |
| Skill review UI | S3 confirm/edit/remove with evidence |
| Team capability | `/capability` endpoint and S5 matrix, coverage, gaps and availability curve |

**Exit criteria:** three real GitHub accounts join a workspace by link; each sees inferred skills with evidence and confirms them; S5 shows coverage and gaps.

## Phase 3 — Project Planning & Assignment Engine

| Deliverable | Detail |
|---|---|
| Constraints | S7 challenge catalog plus required tech, stored as `project_constraints` |
| Ideas | `ideas.generate` / `refine` via SSE; S6 comparison view with deterministic team-fit score |
| Plan | Outline → per-epic tasks fan-out → validators → repair; S8 streaming review, inline edit, versioning |
| Materialize | Accepting a plan creates milestones, tasks (HK numbers), dependencies and embeddings |
| Assignment | `engine/assign` solver plus explanations; S9 lanes, explanation inspector, override and lock, rebalance |
| Task board | S10 board, list and graph views; inspector; CRUD; dependency editing with a cycle check |

**Exit criteria:** from a real team, generate → accept → assign in under 3 minutes; every assignment has a breakdown and an explanation; swapping a team member visibly changes the recommendations.

## Phase 4 — GitHub Integration & Activity Tracking

| Sub-phase | Deliverable |
|---|---|
| **4a (starts in parallel with Phase 2)** | App install flow plus Setup URL verification; repo discovery list; webhook endpoint (HMAC, dedupe, queue); normalization into `activity_events`; author attribution; ProjectRoom DO broadcast; redelivery sweep |
| 4b (after Phase 3 tasks exist) | Confirmed linking (`hk-12` branches, `HK-12` refs); inferred linking via embeddings; "copy branch name" button; unlinked queue and author mapping UI (S12); backfill on connect; guided repo creation (D-4) |

**Exit criteria:** a commit on `hk-3-auth` appears in Mission Control in under 5s, attributed and linked as *confirmed*; a commit with a vague message is linked as *inferred* with a confidence value.

## Phase 5 — Mission Control & Adaptive Intelligence

| Deliverable | Detail |
|---|---|
| Snapshot API | Countdown, health, measured vs. estimated progress, lanes, critical path, blockers, recent activity |
| S11 UI | Live via WS; reconnect and polling fallback |
| Engine | Critical path (CPM over estimates), velocity and forecast, health classification |
| Adaptive v1 (demo-critical) | Rules: stalled task, workload imbalance, critical-path slip → cut scope; `recs.evaluate` on cron and on board change; RecommendationCard accept/dismiss applying typed mutations; reassignment animation |
| Task status suggestions | PR opened → in review; merged → done (auto with undo) |

**Exit criteria:** in a scripted scenario, a stalled critical task produces a reassign recommendation within 2 minutes; accepting it updates the board and Mission Control live for all viewers.

## Phase 6 — Coding-Agent Integrations (P1)

| Deliverable | Detail |
|---|---|
| Tokens | Agent token creation and revocation, privacy toggles (S13 setup panel) |
| Plugin | `packages/agent-plugin`: `hooks/hooks.json` plus `emit.sh` (jq minimization), `userConfig`; marketplace repo; fallback settings.local installer |
| Ingestion | `/agent/events` → session state machine → activity → broadcast |
| UI | S13 session grid; agent dots in Mission Control lanes; link session ↔ task |
| Adaptive hook | "Agent awaiting input > 10 min" check-in recommendation |
| Stretch | Codex hooks adapter (D-10) |

**Exit criteria:** a teammate's Claude Code session appears as *active*; triggering a permission prompt flips it to *awaiting input* in under 3s.

## Phase 7 — Testing, Polish & Submission

| Deliverable | Detail |
|---|---|
| Tests | Engine unit tests (solver, CPM, rules, validators); worker integration tests (webhook signature/idempotency, authZ); Playwright happy path (sign-in mocked, onboarding → plan → assign → MC) |
| AI evals | Fixture teams × ideas; schema/DAG/coverage pass rates |
| Polish | Responsive pass at 375/768/1440; empty/error states; a11y audit (axe); motion |
| Demo | Seeded demo workspace on a Tiger fork; scripted commit pushes; recorded backup video; pre-demo checklist |
| Submission | Devpost write-up, architecture diagram, Figma link, sponsor-specific paragraphs, README |

---

## Post-hackathon roadmap

| Horizon | Theme | Items |
|---|---|---|
| **0–1 month** | Harden | Auth/permission review; multi-project workspaces; GitHub Issues two-way sync; Codex adapter GA; light theme; onboarding analytics; pricing experiment for teams |
| **1–3 months** | Agents as teammates | Model agents as capacity-bearing members (agent "skills" = tools, repos, past task success); assign tasks to *human + agent* pairs; cross-agent conflict detection (sessions touching the same files/branches); session-to-PR outcome tracking; GitHub Agent HQ / Copilot agent ingestion |
| **3–6 months** | Continuous adaptive planning | Sprint mode (rolling plans, not deadlines); learned estimates from team history (per-member velocity by skill); assignment optimization with ILP/CP-SAT behind the same engine interface; what-if simulation ("if Maya is out tomorrow…"); Slack/Discord digests; ElevenLabs voice standups |
| **6–12 months** | Org & startup workflows | Org capability graph across teams; staffing recommendations for new projects; managed dev environments (Coder/devcontainers) launched per task with agent presets; policy controls for agent telemetry; SOC2 path |
| **Commercialization** | | Free for hackathon teams (growth loop through event partnerships: an organizer dashboard aggregating anonymized team health); Team plan ($/seat incl. agent seats); Enterprise (SSO, audit, self-hosted data plane). Moat: the cross-tool capability and outcome graph (who + which agent succeeds at which kinds of tasks) |

**Guardrail:** none of the post-hackathon items change MVP contracts except additive fields. Agent-as-member uses the same `assignments` table with a nullable `agent_profile_id`, added later.
