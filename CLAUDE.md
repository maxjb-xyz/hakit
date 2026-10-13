# Hakit — Agent & Contributor Guide

Hakit is a team OS for hackathons: capability-aware planning, explainable task assignment, adaptive execution.
Read `docs/PRODUCT.md` (what) and `docs/ARCHITECTURE.md` (how) before coding. `docs/archive/` holds the hackathon-era plans; task IDs like `T-305` in comments refer to `docs/archive/TASKS.md`.

## Commands

```bash
pnpm install
pnpm dev                     # apps/web on http://localhost:5173 (Vite + workerd)
pnpm typecheck && pnpm lint && pnpm test   # must pass before every push
pnpm format                  # Prettier
pnpm db:generate             # D1 migration from schema changes (packages/db/migrations)
pnpm db:migrate              # apply migrations to the local D1 (wrangler dev state)
```

Local setup, accounts and secrets: `docs/SETUP.md`.

## Mock mode (default for local dev)

`pnpm dev` runs in mock mode (set `HAKIT_MOCKS=0` in the repo-root `.dev.vars` to turn it off), which gives you:
- fixture responses from every endpoint (`packages/contracts/src/fixtures`)
- a fake signed-in user (Priya, workspace owner)
- mock LLM, embedding and GitHub providers

You can build any screen or engine function without accounts. Real handlers sit behind `mockOr(c, 'T-xxx', …)`; a real path that isn't implemented returns **501 naming the task**.

## Layout

| Path | What |
|---|---|
| `packages/contracts` | Zod schemas, `endpoints` API registry, WS/job messages, fixtures. **The shared contract.** |
| `packages/db` | Drizzle schema, migrations, seeds |
| `packages/engine` | Pure decision logic: capability, plan validation, solver, CPM, adaptive rules |
| `packages/ui` | Design tokens + components |
| `packages/agent-plugin` | Claude Code plugin (hooks → `/api/v1/agent/events`) |
| `apps/web/src/worker/routes` | API handlers, one file per area (identity, planning, tasks, execution, capability, github, agents, realtime, health) |
| `apps/web/src/worker/services` | AI, embeddings, GitHub, planning, skills, capability |
| `apps/web/src/worker/jobs`, `cron/`, `webhooks/`, `do/` | Queue jobs, scheduled sweeps, inbound webhooks, the `ProjectRoom` Durable Object |
| `apps/web/src/client/**` | React app |

## Rules

**Contracts**
- Every API endpoint is declared once in `packages/contracts/src/api.ts`.
- Register it in the worker with `route(app, 'name', handler)` / `sseRoute`.
- Call it from the client with `api('name', { params, body })`. No ad-hoc `fetch('/api/…')`.
- Prefer additive changes (new optional fields, new endpoints). The agent plugin and other clients may be on older versions.
- `apps/web/src/worker/app.test.ts` checks every endpoint against its schema in mock mode. Keep fixtures valid.

**Data**
- Schema changes go in `packages/db/src/schema.ts`, then `pnpm db:generate`. Never edit a migration that has shipped.
- The database is Cloudflare D1: no interactive transactions and at most 100 bound parameters per statement. Commit related writes together with `commit(db, [...])` (one atomic batch), guard conditional writes with `requireChanged`, and chunk id lists with `chunkIds`/`chunkRows` (all in `@hakit/db`).
- Seed data (skills taxonomy, event templates) lives in `packages/db/src/seed`; after editing it, regenerate the seed migration with `pnpm --filter @hakit/db seed:sql` into a new migration file.
- Unit tests never touch a real database. Use fixtures, mock providers or the in-memory test database.

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

- **PRs:** small and focused. Use the PR template. Merge into `main` only when CI is green.
- Note user-visible changes under **Unreleased** in `CHANGELOG.md`. Releases: move them into a `## [x.y.z]` section, bump `version` in the root `package.json`, then push tag `vx.y.z`; the release workflow publishes the notes.
- Hakit is licensed under AGPL-3.0 (`LICENSE`).
