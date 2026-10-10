# Hakit — Team Kickoff

## 1. Message to the whole team

> **Hakit is scaffolded and `main` is green. You can start your slice now.**
>
> **Setup (5 min):**
> ```bash
> git clone https://github.com/maxjb-xyz/hakit && cd hakit
> corepack enable && pnpm install
> cp apps/web/.dev.vars.example apps/web/.dev.vars
> pnpm dev     # http://localhost:5173
> ```
> You should see Mission Control with demo data and "realtime: open". That's **mock mode**: every API endpoint returns fixtures, you're auto-signed-in as Priya, and AI/GitHub are mocked. No accounts are needed to start.
>
> **Read before coding (15 min):**
> - `CLAUDE.md`: rules and who owns which files. Your coding agent reads it automatically.
> - `docs/TASKS.md`: your tasks and acceptance criteria.
> - `docs/HACKATHON.md` §3–5: your workstream, the schedule and the checkpoints.
>
> **Ground rules:**
> 1. One task per branch (`t-201-github-auth`), small PRs, merge to `main` only when CI is green.
> 2. **Contracts are frozen** (`packages/contracts`). Additive changes only. Anything breaking gets posted in the channel first.
> 3. Only **PL** writes DB migrations. Ask PL for schema changes.
> 4. Never commit secrets. They go in `apps/web/.dev.vars` or `wrangler secret put`. Never paste them in chat.
> 5. Run `pnpm typecheck && pnpm lint && pnpm test` before every push.
> 6. Stuck for more than 20 minutes, or found a contract gap? Post in the channel.
>
> **Checkpoints** (everyone merges and we test together):
> - **H10:** real sign-in + webhook live
> - **H18:** plan → assign end to end
> - **H26:** Mission Control live + recommendation accept
> - **H28:** feature freeze
>
> **Slices:**
> - **PL (Platform):** @___
> - **IN (Intelligence):** @___
> - **FE (Frontend/Design):** @___
> - **GH (GitHub/Real-time/Agents):** @___
>
> Your kickoff prompt for Claude Code is in `docs/KICKOFF.md` §2.

## 2. Per-slice kickoff prompts (paste into your Claude Code session)

### PL — Platform

```
You are the Platform (PL) owner on Hakit. Read CLAUDE.md, docs/ARCHITECTURE.md §4–6 and §10, and docs/TASKS.md (T-002, T-003, T-008, T-201–T-203, T-302, T-308, T-311 API, T-502, T-505 API, T-601, T-701–T-702).

Order:
1. T-003: with DATABASE_URL in packages/db/.env, run `pnpm db:migrate && pnpm db:seed` against Tiger dev. drizzle/0002_timescale.sql has never run on TimescaleDB, so fix it first if it fails. Verify that activity_events is a hypertable and that activity_hourly exists.
2. T-201: GitHub App sign-in + sessions in routes/auth-flow.ts and middleware/auth.ts. Hashed session cookie, AES-GCM-encrypted tokens, refresh rotation. Replace mockOr in the `me` and `logout` routes.
3. T-202 / T-203: workspaces, invites, the membership middleware (non-members get 404) and profiles in routes/identity.ts.
Then T-302 (projects/constraints API) and T-308 (plan materialization).

Rules:
- Keep mock mode working: the mockOr fixture branch stays valid until your real path is tested.
- apps/web/src/worker/app.test.ts must stay green.
- Write real-mode tests per route.
- You own packages/db and migrations; other slices ask you for schema changes.
Branch per task (t-201-github-auth). PR to main when CI is green.
```

### IN — Intelligence

```
You are the Intelligence (IN) owner on Hakit. Read CLAUDE.md, docs/AI.md (all of it), docs/ARCHITECTURE.md §8, and docs/TASKS.md (T-005, T-204–T-206, T-301, T-303, T-305–T-306, T-309–T-310, T-501, T-504, T-703).

Order:
1. T-309 + T-310: the assignment solver and explanations in packages/engine/src/assign/. Pure functions, deterministic, under 200 ms for 6×60. Property tests for capacity, locks, avoid lists and determinism. Build against the fixtures in @hakit/contracts/fixtures.
2. T-306: plan validators in packages/engine/src/planning/validate.ts (topoSort already exists).
3. T-204 / T-205: skill inference in packages/engine/src/capability/infer.ts (dep-map.ts is done), the skills.import job, and the embedding router (HF → AMD → Workers AI, all Qwen3-Embedding-0.6B at 1024 dimensions).
4. T-301 → T-303 → T-305: the Gemini provider in services/ai/gemini.ts (responseJsonSchema via toGeminiSchema, thinkingLevel, re-validate with Zod, one repair retry), then ideas and the plan pipeline over SSE.
5. T-501 → T-504: critical path, health, and adaptive rules v1 (stall → reassign is demo-critical).

Rules:
- packages/engine has no I/O and no Date.now().
- An LLM never produces a number that drives a decision.
- Unit-test everything with fixtures; never hit real APIs in tests.
Branch per task. PR to main when CI is green.
```

### FE — Frontend / Design

```
You are the Frontend/Design (FE) owner on Hakit. Read CLAUDE.md, docs/DESIGN.md (all of it), and docs/TASKS.md (T-102–T-106, T-207–T-209, T-304, T-307, T-311 UI, T-312, T-407, T-503, T-505 UI, T-604, T-704).

Order:
1. T-102 / T-103: primitives on Radix and the domain components (SkillChip, ScoreBreakdown, ExplanationCard, RecommendationCard, ActivityItem, TaskCard, ProgressBar with measured vs estimated) in packages/ui. Follow the pattern in packages/ui/src/components/Button.tsx and show everything on /_ui.
2. T-104 / T-106: finish the app shell (inspector panel, ⌘K) and build Mission Control (S11) from the fixture snapshot. It's the hero screen and the demo fallback (?demo=1).
3. Then S9 assignment review, S8 plan review, and S3 skill import, in that order (demo-critical).

Rules:
- Tokens only (packages/ui/src/tokens.css).
- Data comes only through `api('endpointName', …)` and `stream(...)` from src/client/lib/api.ts, with TanStack Query.
- Live updates come from useProjectSocket.
- Every screen needs empty, loading and error states, and must work at 375px.
- Keep each screen in its own file under src/client/routes/ and replace its placeholder in routes/screens.tsx.
Mock mode gives you all data. If a screen needs a field the contract lacks, raise it with PL; don't invent it.
Branch per task. PR to main when CI is green.
```

### GH — GitHub / Real-time / Agents

```
You are the GitHub/Real-time/Agents (GH) owner on Hakit. Read CLAUDE.md, docs/INTEGRATIONS.md §1 and §6, docs/ARCHITECTURE.md §7–9, and docs/TASKS.md (T-006, T-401–T-409, T-506, T-602–T-605).

Order:
1. T-006: register the "Hakit Dev" and "Hakit" GitHub Apps (docs/SETUP.md §3). Convert the key to PKCS#8. Start a cloudflared tunnel for webhooks. Put the secrets in apps/web/.dev.vars only.
2. T-401: in webhooks/github.ts and services/github, verify the HMAC on the raw body with crypto.subtle (constant time), dedupe via webhook_deliveries, enqueue, and return 202. Test bad-signature, duplicate and unknown-event cases.
3. T-403: the github.webhook job handler. Normalize push/create/delete/pull_request/review into activity_events. Attribute authors (user id → noreply email parse → alias). Broadcast after commit. Use linking/refs.ts for HK- links.
4. T-402: the installation flow, Setup URL verification via GET /user/installations, and the repo list/connect endpoints.
5. T-404 hardening (the ProjectRoom Durable Object and useProjectSocket already work): membership check on WS upgrade, plus the polling fallback.
6. Then T-406 linking, and after C3, T-602/T-603: agent ingestion and the Claude Code plugin in packages/agent-plugin.

Rules:
- Webhooks must ack fast; all processing goes through the queue and must be idempotent.
- Never log payload secrets.
- Agent telemetry stays minimized and opt-in.
Branch per task. PR to main when CI is green.
```

## 3. Account setup owners (do in the first 2 hours)

| What | Who | Guide |
|---|---|---|
| Tiger Cloud service + share the URL privately | PL | SETUP §2 |
| Cloudflare: login, Hyperdrive, queues, first deploy | PL | SETUP §4 |
| GitHub Apps (dev + prod), tunnel | GH | SETUP §3 |
| Gemini key, Hugging Face token | IN | SETUP §5 |
| Figma file + variables | FE | DESIGN §11 |
| Confirm the sponsor challenges on Devpost and the Hackers Guide; update `packages/db/src/seed/hackathons.ts` | Team lead | INTEGRATIONS §0 |
| Branch protection on `main` | Repo owner | SETUP §6 |
