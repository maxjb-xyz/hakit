# Hakit — Product Requirements

> **Hakit — The Hackathon OS that knows your team and knows what to build next.**

Status: **Planning draft v1 — awaiting approval.** Nothing in this document is implemented yet.

Related: [ARCHITECTURE](./ARCHITECTURE.md) · [DESIGN](./DESIGN.md) · [AI](./AI.md) · [INTEGRATIONS](./INTEGRATIONS.md) · [SETUP](./SETUP.md). Hackathon-era planning (competitive analysis, phases, tasks, risks) is in [archive](./archive/).

---

## 1. Problem

Hackathon teams lose most of their first six hours and their last six hours to coordination, not code:

- **Forming a plan is guesswork.** Teams pick ideas that sound impressive rather than ideas this specific group of people can ship in 36 hours. Sponsor requirements and judging criteria are read once and forgotten.
- **Work is divided by who speaks first.** The person who knows React ends up on the backend; nobody owns the demo; two people build the same auth flow.
- **Nobody knows where the project actually is.** Status lives in heads and Discord scrollback. Blockers surface at hour 30.
- **AI coding agents multiply the problem.** Each teammate now runs one or more Claude Code / Codex sessions. Nobody can see what those agents are doing, which task they map to, or whether one is stuck waiting for input.

Existing tools (Linear, GitHub Projects, Notion, Hackord-style dashboards) are **containers for plans humans already made**. Hakit's job is to **make and continuously repair the plan**, grounded in who is actually on the team.

## 2. Positioning

Hakit is **an orchestration layer, not a collaboration dashboard.** Chat, video, and hackathon discovery are explicitly out of scope — teams already have Discord.

### Three differentiators (must be visible in every demo minute)

| # | Differentiator | What the user sees | What makes it real (not a prompt wrapper) |
|---|---|---|---|
| D1 | **Capability-Aware Planning** | Ideas, scope, stack and timeline that change when the team changes. "Your team has no mobile experience — we recommend a web PWA." | Structured team capability profile (evidence-backed, confidence-scored, member-confirmed) is a hard input to planning; plans are validated against it deterministically (stack coverage check). |
| D2 | **Explainable Work Allocation** | Every assignment shows *why*: skill match, workload, preference, dependency position, confidence. One-click override. | Deterministic scoring + constraint solver over semantic match scores (Hugging Face embeddings). LLM only writes the prose; numbers come from the solver. |
| D3 | **Adaptive Execution** | "Auth is on the critical path and has had no commits in 3h. Maya just finished her task and has 82% match — reassign?" | Rules over live GitHub + agent telemetry (stall detection, critical-path slack, workload imbalance) produce typed recommendations that the user accepts/rejects. |

## 3. Target users

| Persona | Context | Primary need |
|---|---|---|
| **Team lead / organizer** ("Priya") | Formed a team of 3–5, has a vague idea, wants to win a sponsor track | Fast, credible plan; fair division of work; see if we'll make the deadline |
| **Specialist** ("Marcus", backend) | Strong in one area, unsure what to pick up | Clear assignment that fits skills; knows what blocks whom |
| **First-time hacker** ("Jae") | Few repos, nervous about being useless | Gets tasks sized to their ability, with a stretch goal tied to their interests |
| **Agent-heavy developer** ("Sam") | Runs 2–3 Claude Code sessions in parallel | Team sees agent work without manual status updates |
| *(Post-hackathon)* Startup eng lead | 3–15 engineers + agents, weekly cycles | Continuous capability-aware planning and agent coordination |

## 4. Core user journey (P0 path in **bold**)

1. **Sign in with GitHub** (GitHub App user authorization — one click).
2. **Create workspace** → name, hackathon (pre-seeded Knight Hacks 2026 template: deadline, tracks, sponsor challenges, judging criteria).
3. **Invite teammates** via a single link (`hakit.dev/j/<code>`); they sign in with GitHub and land in the team.
4. **Skill import**: Hakit reads each member's *public* GitHub repos (languages, topics, dependency manifests, READMEs) → proposes skills with evidence and confidence. Member confirms/edits, adds interests, availability (hours awake/working during event), and preferences ("want to learn", "avoid").
5. **Team capability profile** is assembled: coverage map (frontend, backend, data, ML, infra, design, mobile, hardware), gaps, overlaps, availability curve.
6. **Project definition**: submit an existing idea *or* ask for ideas. Select sponsor challenges and required technologies; Hakit shows constraint fit.
7. **Plan generation**: Gemini produces a structured plan (scope, MVP cut, architecture, milestones, tasks with skill requirements, estimates, dependencies). Deterministic validators check feasibility vs. team hours and coverage.
8. **Assignment**: solver assigns tasks; each assignment has an explanation card. Team reviews, overrides, locks.
9. **Repository connection**: install the Hakit GitHub App on an existing repo or create a new one from Hakit; no manual webhook setup.
10. **Live tracking**: commits, branches, PRs stream into Mission Control, attributed to members and linked to tasks (branch naming `hk-<id>`, PR body, or inferred — inferred links are visually distinct).
11. **Mission Control**: deadline countdown, milestone progress (measured vs. estimated), who's on what, critical path, blockers, health.
12. *(P1)* **Agent visibility**: opt-in Claude Code hooks show sessions as active/idle/awaiting input, linked to task + member.
13. *(P1)* **Adaptive recommendations**: stall/imbalance/critical-path alerts with one-click reallocation or scope cut.
14. *(P2)* **Submission prep**: checklist, auto-drafted Devpost description from the plan + activity.

Design rule: **every step after sign-in must have a sensible default** so a team can reach Mission Control in under 10 minutes.

## 5. Feature priorities

### P0 — Hackathon MVP (must demo end-to-end)

**Team Intelligence**
- GitHub sign-in (GitHub App user-to-server auth).
- Workspace creation; invite link with expiry + role (owner/member).
- Member profile: skills (inferred + confirmed), interests, availability windows, preferences.
- GitHub-derived capability evidence from public repos (languages, manifests → frameworks, topics).
- Member confirmation/editing of inferred skills (confirmed > inferred in all downstream logic).
- Team capability overview: coverage, gaps, overlaps, total available hours.

**Intelligent Project Planning**
- Idea generation (3 candidates) and refinement of a user-supplied idea.
- Sponsor challenge + required product/API constraint selection (seeded catalog per hackathon).
- Team-aware recommendations with fit rationale per idea.
- MVP scoping with explicit cut line (must / should / could).
- Proposed technical architecture (components + chosen stack, justified by team skills).
- Milestones, tasks, dependencies, estimates (hours), required skills per task.
- Explainable task assignment with override.
- Editable task board (status, assignee, estimate, dependencies).

**GitHub Integration**
- Repository discovery (repos where the App is installed) and selection.
- Repository creation from Hakit (see INTEGRATIONS §1.6 — approval decision D-4).
- Zero manual webhook configuration (App-level webhook).
- Live commits, branches, PRs (+ reviews/merges) ingested within seconds.
- Member attribution (GitHub user ID → member; email fallback; unknown authors surfaced).
- Activity ↔ task association: confirmed (branch/PR/commit references `HK-12`) vs. inferred (semantic match), visually distinguished.

**Mission Control**
- Single project dashboard: countdown, milestone progress, per-member current task, live activity feed, dependency view of critical path, blockers list, health indicators (on-track / at-risk / off-track) with the reason.

### P1 — Differentiators beyond MVP

- **Adaptive Execution**: stall detection, workload imbalance, reallocation recommendations, deadline-aware scope reduction, critical-path change alerts. *(A minimal version — stall + reassignment — is targeted for the hackathon demo; see HACKATHON.md.)*
- **Coding-Agent Visibility**: Claude Code hooks → session status (active / idle / awaiting input / ended), tool activity summary, linkage to member + task, opt-in per user and per repo.

### P2 — Stretch

- Cross-agent conflict detection (two sessions editing same files).
- Advanced capability visualization (radar/graph).
- Auto-drafted submission description; submission checklist.
- GitHub Issues sync.
- ElevenLabs voice standups/briefings.
- Historical analytics.

### Explicit non-goals (for the hackathon)

Chat, video, hackathon discovery/listing, team matchmaking between strangers, hosting agent execution, reading private source code with AI, mobile-native apps, multi-hackathon organizer tooling.

## 6. Key product principles

1. **Evidence over vibes.** Every inferred skill shows its evidence; every assignment shows its score breakdown; every progress number says whether it is *measured* (GitHub/agent events, task status) or *estimated* (LLM/heuristic).
2. **Human in the loop, one click away.** AI recommends, humans decide. Every recommendation is accept / modify / dismiss. Overrides are remembered and feed the solver as hard constraints.
3. **Zero-config by default.** Seeded hackathon templates, defaults for availability, auto-detected repos.
4. **Degrade gracefully.** If Gemini or Hugging Face is down, the product still works: deterministic fallbacks (keyword skill matching, template plans, manual task entry).
5. **Least privilege.** Read only what is needed; never send private code to AI providers without explicit consent; agent telemetry is opt-in.

## 7. Success metrics

**Hackathon demo**
- New team → Mission Control with an assigned plan in **< 5 min live**.
- A real commit appears in Mission Control in **< 5 s**.
- Adaptive recommendation shown and accepted live.
- Judges can articulate the three differentiators after the demo.

**Product (post-hackathon)**
- Time-to-first-plan, % assignments accepted without override, % tasks linked to activity, recommendations acceptance rate, weekly active teams, retention across a second event.

## 8. Glossary

| Term | Meaning |
|---|---|
| Workspace | A team in the context of one event/project container (1 workspace : N projects; hackathon MVP uses 1). |
| Member | A user's membership in a workspace with role, availability, preferences. |
| Capability | A normalized skill (taxonomy node) + level + confidence + evidence for a member. |
| Evidence | A typed, sourced fact supporting a capability (repo language bytes, manifest dependency, self-report, completed task). |
| Plan | Versioned structured output: scope, architecture, milestones, tasks, dependencies. |
| Assignment | Task → member mapping with score breakdown, explanation, source (solver / manual / reallocation). |
| Activity | Normalized GitHub or agent event attributed to a member and optionally linked to a task. |
| Recommendation | Typed adaptive suggestion (reassign / split / cut scope / unblock) with rationale and status. |
| Measured vs. estimated | Measured = derived from events/status; estimated = model or heuristic projection. Always labeled. |
