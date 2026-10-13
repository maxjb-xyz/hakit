# Hakit — Submission Assets (T-706)

The Devpost write-up, a built-with list taken from the actual stack, and a checklist of everything to capture before submitting. Paste the sections below into Devpost and edit the bracketed parts. Keep the claims honest: anything not demonstrated live is described as built and tested, not as proven at scale.

---

## Devpost write-up

**Tagline:** The hackathon OS that knows your team and knows what to build next.

### Inspiration

Every hackathon we've done lost the first six hours and the last six to coordination, not code. We picked ideas that sounded impressive instead of ones this group could ship. Work went to whoever spoke first. The person who knew React ended up on the backend. Blockers surfaced at hour 30. Now each of us also runs one or more AI coding agents, and nobody can see what those agents are doing or whether one is stuck. Existing tools hold plans that humans already made. We wanted a tool that makes the plan, and keeps repairing it, based on who is actually on the team.

### What it does

Hakit is an orchestration layer for hackathon teams:

- **Capability-aware planning.** Each member's skills are inferred from public GitHub evidence (languages, manifests, topics), scored for confidence and confirmed by the member. Hakit generates ideas grounded in those skills and the sponsor challenges you select. It then streams a full plan: scope, architecture, milestones, epics and tasks. Every plan goes through deterministic validators covering the dependency graph, skill grounding, capacity with an integration buffer, schedule against the deadline, challenge coverage and required deliverables. If the plan doesn't fit, scope is cut and the numbers are shown. Swap one teammate and the plan changes, with a coverage diff that explains why.
- **Explainable assignment.** A constraint solver assigns tasks using skill fit, semantic fit from embeddings, load balance, continuity, availability and critical-path pressure. Every assignment shows its score breakdown and the two best alternatives. You can override and lock any pick.
- **Live execution tracking.** GitHub commits, PRs and branches stream into Mission Control over WebSockets. Activity is linked to tasks: `hk-4-…` branches and `HK-4` references are confirmed links, everything else is inferred. A Claude Code plugin reports agent sessions, including "awaiting input".
- **Adaptive recommendations.** Rules over the live state detect stalled critical-path tasks, overload and scope risk. Hakit proposes concrete fixes such as reassigning, splitting or cutting, with the measured signals behind each one. Accepting applies the fix in one transaction.

Throughout, measured values are labelled separately from estimates, and LLM output is never the decision. The model proposes candidates and prose. The engine computes scores, hours, health and the critical path.

### How we built it

- **One Cloudflare Worker** (Hono) serves the API and the React 19 SPA, built with Vite and the Cloudflare plugin. Durable Objects hold one `ProjectRoom` per project for WebSocket fan-out with hibernation. Queues carry webhook, backfill, embedding and recommendation jobs. A cron re-evaluates recommendations every two minutes.
- **Tiger Cloud (Postgres + TimescaleDB + pgvector)** through Hyperdrive and Drizzle ORM. Activity events live in a hypertable with a continuous aggregate for Mission Control sparklines. Member and task embeddings live in pgvector.
- **Gemini** produces structured planning (ideas, outline, per-epic tasks, repair) as JSON validated with Zod at every boundary. Epics are generated with bounded concurrency and streamed to the browser over SSE. When the provider is unavailable, a circuit breaker falls back to an editable template plan.
- **Hugging Face Inference Providers** serve **Qwen3-Embedding-0.6B**, an open-weight model, for semantic task/member fit and activity linking. A keyword/alias fallback covers outages.
- **A pure TypeScript decision engine** (`packages/engine`) holds capability inference, plan validation, the assignment solver, CPM scheduling and adaptive rules. It has no I/O and takes time as an input, so every decision is deterministic and unit-tested.
- **A shared contract package** declares every endpoint once with Zod schemas, fixtures and an endpoint registry. This let four workstreams build in parallel against a mock mode from hour one.
- **The GitHub App** handles sign-in, installation webhooks (signature-verified, deduplicated, enqueued) and repository backfill. A **Claude Code plugin** with hooks sends minimized, opt-in agent telemetry.
- **Quality:** Vitest across the engine and worker, including real-mode route tests on in-memory Postgres with the real migrations, an authorization matrix over every endpoint, planning evals over golden team × idea fixtures, and a Playwright end-to-end happy path.

### Challenges we ran into

- **Keeping the model out of the decisions.** It's tempting to let the LLM estimate hours or pick assignees. We kept it to proposing candidates and wrote validators that repair or cut its output deterministically.
- **Feasibility that means something.** Capacity, schedule and critical path had to agree with each other. Cut-line logic had to cut optional dependants without leaving dangling edges, and never cut a prerequisite of mandatory work.
- **Real-time without lying.** We had to broadcast only after commits, replay missed events on reconnect, fall back to polling, and label inferred links as inferred.
- **Parallel development.** Four streams changed one codebase over 36 hours. The contract-first mock mode and the per-endpoint 501 "names the task" pattern kept us unblocked.

### Accomplishments that we're proud of

- The "same idea, different team" guarantee is tested: swapping the team changes the plan, and the coverage diff explains the change.
- Every assignment and recommendation can be explained from engine numbers, not model prose.
- One deploy target with live WebSockets, queues and a Postgres time-series backend, still within the hackathon.
- [Add: number of tests, and the measured latency from push to Mission Control in the dry run.]

### What we learned

[Fill in from the team retro, e.g. structured output plus deterministic validation beats prompt tuning; contracts first saves hours later.]

### What's next for Hakit

- Voice standups and an ElevenLabs mission briefing.
- Cross-agent conflict detection when two sessions touch the same files or branch.
- GitHub Issues sync, a capability radar, and historical analytics across events.
- Organizer mode: team formation from skill profiles across a whole hackathon.

---

## Built with

Taken from the repository's `package.json` files and `wrangler.jsonc`:

`typescript` · `react` (19) · `react-router` · `tanstack-query` · `tailwindcss` (v4) · `vite` · `hono` · `zod` · `cloudflare-workers` · `cloudflare-durable-objects` · `cloudflare-queues` · `cloudflare-hyperdrive` · `postgresql` · `timescaledb` · `pgvector` · `tiger-cloud` · `drizzle-orm` · `gemini` · `hugging-face` · `qwen3-embedding` · `github-app` / `github-api` · `claude-code` (plugin) · `vitest` · `playwright` · `pglite` · `pnpm` · `figma`

### Sponsor paragraphs (only for challenges we entered; verify challenge wording on Devpost first)

- **Hugging Face:** Semantic matching runs on Qwen3-Embedding-0.6B, an open-weight model from the Hub, served through HF Inference Providers. Embeddings drive task-to-member semantic fit, learning-goal interest fit and inferred commit-to-task linking. The same model and dimension are used on every path, so vectors stay comparable.
- **Tiger Data:** Activity is a TimescaleDB hypertable with a continuous aggregate behind Mission Control's per-member sparklines. pgvector stores member and task embeddings in the same database.
- **Gemini:** Structured JSON output drives idea generation and the staged plan pipeline (outline, then per-epic tasks, then a repair round), validated with Zod and scored by deterministic validators. We have opt-in live evals for it.

---

## Capture checklist

Screenshots at 1440×900 and 2× DPR, dark theme, from mock mode unless noted. Save them to `docs/submission/` (not committed if large).

- [ ] **Mission Control** (S11): lanes, health, critical path, an open recommendation
- [ ] **Recommendation detail**: signals, then the accepted state
- [ ] **Team capability** (S5) and a **member profile** (S4) with evidence and confirmed/inferred chips
- [ ] **Constraints** (S7) with a sponsor challenge selected
- [ ] **Ideas** (S6) with team-fit meters
- [ ] **Plan review** (S8) mid-stream, and a feasibility banner with cut tasks
- [ ] **Same idea, different team**: the two plans side by side (real mode, after `demo swap`)
- [ ] **Assignment review** (S9) with an open explanation and alternatives
- [ ] **Task board and inspector** (S10)
- [ ] **Code** (S12) with a confirmed and an inferred link
- [ ] **Agents** (S13) with an "awaiting input" session
- [ ] **⌘K palette**
- [ ] **Mobile MC** at 375px
- [ ] **Architecture diagram** from ARCHITECTURE §1, exported as PNG
- [ ] **Figma link** to the "Hakit DS" file, shared as view-only

Video (≤ 3 min for Devpost; the live pitch is 5 min):

- [ ] Record the HACKATHON §8 beats from docs/DEMO.md §1, in real mode if the dry run is clean, otherwise mock mode
- [ ] Add captions for the three differentiators (D1–D3)
- [ ] Keep a local copy as the backup video for the live demo (DEMO §5)
- [ ] Upload unlisted to YouTube and paste the link into Devpost

Submission form:

- [ ] Public GitHub repo URL; README has setup instructions (`pnpm install`, `.dev.vars`, `pnpm dev`)
- [ ] Track and sponsor challenges selected, matching the sponsor paragraphs above
- [ ] All team members added on Devpost
- [ ] The tagged release candidate (`v0.1-demo`) matches the demoed build
