# Hakit — Agent & Contributor Guide

Hakit is a hackathon team OS: capability-aware planning, explainable task assignment, adaptive execution.
Read `docs/PRODUCT.md` (what), `docs/ARCHITECTURE.md` (how), `docs/TASKS.md` (your task's acceptance criteria) before coding.

## Commands

```bash
pnpm install
pnpm dev                     # apps/web on http://localhost:5173 (Vite + workerd)
pnpm typecheck && pnpm lint && pnpm test   # must pass before every push
pnpm format                  # Prettier
pnpm db:generate             # Drizzle migration from schema changes (PL only)
pnpm db:migrate              # apply to Tiger dev (PL only)
pnpm db:seed                 # skills taxonomy + Knight Hacks IX template (PL only)
```

Local setup, accounts and secrets: `docs/SETUP.md`.

## Mock mode (default for local dev)

`apps/web/.dev.vars` with `HAKIT_MOCKS=1` gives you:
- fixture responses from every endpoint (`packages/contracts/src/fixtures`)
- a fake signed-in user (Priya, workspace owner)
- mock LLM, embedding and GitHub providers

You can build any screen or engine function without accounts. Real handlers replace `mockOr(c, 'T-xxx', …)` calls one task at a time. Unimplemented real paths return **501 naming the task**.

## Layout & ownership

| Path | What | Owner |
|---|---|---|
| `packages/contracts` | Zod schemas, `endpoints` API registry, WS/job messages, fixtures. **The shared contract.** | PL (changes need all-stream sign-off) |
| `packages/db` | Drizzle schema, migrations, seeds | PL |
| `packages/engine` | Pure decision logic: capability, plan validation, solver, CPM, adaptive rules | IN |
| `packages/ui` | Design tokens + components | FE |
| `packages/agent-plugin` | Claude Code plugin (hooks → `/api/v1/agent/events`) | GH |
| `apps/web/src/worker/routes/identity.ts`, `planning.ts` (projects), `tasks.ts` (CRUD), `execution.ts` (snapshot/accept), `middleware/`, `routes/health.ts` | API | PL |
| `apps/web/src/worker/routes/capability.ts`, `planning.ts` (ideas/plans), `tasks.ts` (solve/explain), `services/ai`, `services/embeddings`, `jobs` for skills/embed/recs | Intelligence | IN |
| `apps/web/src/worker/routes/github.ts`, `agents.ts`, `agent-ingest.ts`, `realtime.ts`, `webhooks/`, `do/`, `services/github`, jobs for github/activity/agent | GitHub / real-time / agents | GH |
| `apps/web/src/client/**` | React app | FE |

PL = Platform, IN = Intelligence, FE = Frontend/Design, GH = GitHub/Real-time/Agents (`docs/HACKATHON.md` §3). Each endpoint's owner is also recorded in `endpoints[*].owner`.

## Rules

**Contracts**
- Every API endpoint is declared once in `packages/contracts/src/api.ts`.
- Register it in the worker with `route(app, 'name', handler)` / `sseRoute`.
- Call it from the client with `api('name', { params, body })`. No ad-hoc `fetch('/api/…')`.
- Contract changes after the freeze must be **additive**: new optional fields or new endpoints. A breaking change needs a PR approved by all four workstreams.
- `apps/web/src/worker/app.test.ts` checks every endpoint against its schema in mock mode. Keep fixtures valid.

**Data**
- Only PL writes migrations. Others open a PR against `packages/db/src/schema.ts` or ask PL.
- Everyone shares the Tiger dev database. Don't run destructive SQL there.
- Unit tests never touch the database. Use fixtures and mock providers.

**Engine**
- `packages/engine` stays pure: no `fetch`, no DB, no `Date.now()`. Time comes in via `ProjectState.now`.
- Model output is never a decision. LLMs produce candidates and prose; the engine computes scores, hours, health and the critical path (docs/AI.md).

**Worker**
- Validate every boundary with Zod: HTTP (the route helper does it), queue messages, WS messages and AI outputs.
- Broadcast to the `ProjectRoom` (`lib/broadcast.ts`) only after the DB write has committed.
- Webhooks: verify the signature on the raw body, dedupe by delivery ID, enqueue, and return 202 fast.
- Never log tokens, secrets, prompts or code.

**UI** (docs/DESIGN.md §12)
- Use tokens only. No raw hex or px outside the scales in `packages/ui/src/tokens.css`.
- Every view needs empty, loading and error states.
- Label measured vs estimated values and confirmed vs inferred links.
- Keyboard-reachable; visible focus; never convey status by colour alone.

**Security & privacy**
- Secrets go only in `.dev.vars` (gitignored) or `wrangler secret put`.
- Never send private repo content to AI providers.
- Agent telemetry is opt-in and minimized.

## Workflow

- **Branches:** `hk-<task-number>-short-name` for Hakit board tasks, or `t-<TASKS id>-short-name` for scaffold tasks (e.g. `t-201-github-auth`).
- **PRs:** small, one task each. Use the PR template. Merge into `main` only when CI is green. Deploys run from `main`.
- **Integration checkpoints** (docs/HACKATHON.md §5): stop and merge before each.
- If you find a contract gap, raise it in the team channel before working around it.
