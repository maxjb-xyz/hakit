# Hakit — 36-Hour Hackathon Execution Plan

Status: **Planning draft v1.**

> ⚠️ **Timing:** Knight Hacks IX runs **Oct 9–11, 2026**, and today is **Oct 10**. If Hakit is meant for this event, part of the window has already passed. This schedule uses **relative hours (H0 = start of building)**. See decision D-1 and RISKS R-0 for the options: build now with a reduced scope, or target a later event.

## 1. Feasibility in one paragraph

The full P0 list in TASKS.md adds up to about **150 engineer-hours**. Four developers working 36 hours, with sleep rotation, integration overhead and the demo, produce about **100–115 focused hours**. The P0 path is therefore **feasible only if** all four of these hold:
- (a) each developer drives coding agents in parallel (a realistic 1.4–1.8× multiplier on well-specified tasks with frozen contracts)
- (b) the "demo cut" below is applied up front
- (c) all external setup (GitHub App, Tiger, Hyperdrive, Gemini/HF keys, Workers Paid) is finished by H2
- (d) design and backend run in parallel from H0

With three developers, Phase 6 (agents) and the S12 polish must go. With two, the scope becomes "planning + assignment + live GitHub feed" only.

### Demo cut (applied from H0; these are the P0 items deferred to "if time")
| Deferred | Saves | Replacement |
|---|---|---|
| Plan versioning and regenerate-section | ~3h | Edit inline; regenerate the whole plan |
| Graph view of the task board | ~2h | Dependencies shown in the inspector plus the critical path in MC |
| Idea refine endpoint | ~1.5h | Regenerate with guidance text |
| Repo creation via API (T-409) | ~2h | Guided `github.com/new` URL |
| Backfill on connect | ~1.5h | Demo repo starts empty |
| Full responsive pass on secondary screens | ~3h | Mobile polish only for S11 and S1 |
| Wireframe-only screens S4, S14 | ~4h | Minimal functional versions |
| **Total** | **~17h** | |

What remains is about 133h of P0. With agents, that is roughly 80–95 human-hours. **Tight but achievable** for four strong developers.

## 2. Critical path

```
GitHub App + Tiger + Hyperdrive + deploy (H0–2)
  → Contracts freeze C1 (H3)
    → Auth + workspaces (H3–8) → Skill import (H6–11) → Capability API (H10–12)
      → Ideas (H12–14) → Plan pipeline + validators (H12–17) → Materialize (H17)
        → Solver + explanations (H13–18, against fixtures) → Assignment UI (H17–20)
          → Activity↔task linking (H19–21) → MC snapshot + live UI (H20–24)
            → Adaptive rules + accept (H21–26) → Feature freeze H28 → Demo H34
```

The longest chain is **auth → skill import → planning → assignment → linking → Mission Control → adaptive**. Two things keep it moving:
- `packages/engine` (solver, CPM, rules) is built **against fixtures** from H3 and never waits for real data.
- The webhook pipeline (GH) is built **in parallel** from H3 and does not wait for planning.

## 3. Team & workstreams (4 developers)

| Dev | Workstream | Owns (TASKS IDs) | Primary agent usage |
|---|---|---|---|
| **A: Platform** | PL | T-001–004, T-007–008, T-201–203, T-302 API, T-308, T-311 API, T-502, T-505 API, T-601, T-701–702 | Hono routes, Drizzle queries, tests |
| **B: Intelligence** | IN | T-005, T-204–206, T-301, T-303, T-305–306, T-309–310, T-501, T-504, T-703 | Engine functions with property tests; prompts |
| **C: Frontend/Design** | FE | T-101–106, T-207–209, T-304, T-307, T-311 UI, T-312, T-407, T-503, T-505 UI, T-604, T-704 | Components from Figma via MCP; screens from contracts |
| **D: GitHub/Real-time/Agents** | GH | T-006, T-401–406, T-408, T-506, T-602–603 | Webhook fixtures, DO, plugin |

If there is a **fifth person or a dedicated designer**, they own T-105 (Figma) and T-104/T-106, and move to the demo kit, submission and pitch (T-705–706) from H24.

## 4. Hour-by-hour schedule

| Hours | A: Platform | B: Intelligence | C: Frontend/Design | D: GitHub/RT | Checkpoint |
|---|---|---|---|---|---|
| **H0–1** | Kickoff (30 min, everyone): read docs, confirm D-decisions, assign roles. T-001 scaffold | Gemini/HF keys, model verify, T-005 taxonomy draft | Figma file, tokens draft (T-105/T-101) | T-006 GitHub Apps, tunnel | |
| **H1–3** | T-002, T-003 Tiger + Hyperdrive, T-007 CI | T-004 AI schemas (with A) | T-101 tokens, T-102 primitives start | T-401 webhook endpoint | **C0 (H2): prod URL live, health green** |
| **H3** | **Contracts freeze** | | | | **C1: contracts v1 merged** |
| **H3–6** | T-201 auth/sessions | T-205 embeddings, T-005 seeds + embeddings | T-102, T-104 shell | T-404 ProjectRoom DO + WS client | |
| **H6–9** | T-202 workspaces/invites, T-203 | T-204 skill import | T-103 domain components, T-207 S1/S2 | T-402 install + repo discovery, T-403 normalization | |
| **H9–10** | **Integration #1 (30 min):** real sign-in → workspace → invite second member → webhook commit stored and broadcast | | | | **C2 (H10): auth + webhook live on prod** |
| **H10–13** | T-302 constraints API, T-008 | T-206 capability, T-301 LLM layer, T-303 ideas | T-208 S3/S4, T-106 MC mock | T-403 finish, T-405 (if time) | |
| **H13–17** | T-308 materialize, T-311 API | T-305 plan pipeline, T-306 validators, T-309 solver (fixtures) | T-209 S5, T-302 UI S7, T-304 S6 | T-406 linking (confirmed regex first) | |
| **H17–18** | **Integration #2:** real team → ideas → plan → accept → solve | | | | **C3 (H18): plan→assign E2E on prod** |
| **H18–21** | T-502 MC snapshot | T-310 explanations, T-501 CPM/health | T-307 S8, T-311 S9 | T-406 inferred linking, T-602 agent ingestion (P1) | |
| **H21–24** | T-505 API, T-601 tokens (P1) | T-504 adaptive rules | T-312 S10 board + inspector | T-603 Claude Code plugin (P1), T-506 | |
| **H24–26** | T-701 E2E start | Prompt tuning, T-703 evals | T-503 MC live, T-505 UI | T-407 S12 basic | **C4 (H26): MC live + recommendation accept on prod** |
| **H26–28** | Bug fixing | Bug fixing; demo-scenario tuning | T-604 S13 (P1) | Agents → MC dots | **H28: FEATURE FREEZE** |
| **H28–31** | T-702 security tests, fixes | Plan quality review (3 plans) | T-704 responsive/a11y on S11, S1, S9 | Webhook load test, redelivery check | |
| **H31–33** | T-705 demo kit (seed fork, push script) | Backup recordings | Visual polish, empty states | Pre-demo checklist dry run | **C5 (H31): release candidate deployed; tag `v0.1-demo`** |
| **H33–35** | **Demo rehearsal ×3**, record backup video, T-706 Devpost | | | | |
| **H35–36** | Submit (Devpost + GitHub), buffer | | | | **Submission ≥ 60 min before deadline** |

**Sleep:** each developer takes two 2.5h blocks, staggered so that at least three are awake H0–24. No one sleeps during the integration checkpoints. Suggested: A H14–16.5 and H27–29.5; B H18–20.5 and H29–31.5; C H15–17.5 and H28–30.5; D H19–21.5 and H26–28.5. Shift ownership of in-flight tasks before sleeping.

## 5. Integration & deployment checkpoints

| ID | Time | Pass condition | If it fails |
|---|---|---|---|
| C0 | H2 | Prod URL serves the SPA; `/health/deep` green (or each red item has an owner) | Hyperdrive red: connect directly with `pg` over TLS temporarily. Tiger red: Neon/Supabase as an emergency fallback (TimescaleDB features lost; continuous aggregate becomes a plain view) |
| C1 | H3 | Contracts merged; every workstream compiles against them | Timebox 30 min more; whatever isn't agreed by then gets an owner who decides |
| C2 | H10 | Real GitHub sign-in; invite join; real commit → DB → WS broadcast in < 5s | Polling fallback (the cron fetches recent commits every minute) so the demo still shows live-ish activity |
| C3 | H18 | Generated plan accepted; solver assigns with explanations | Template plan plus solver (the solver is deterministic and independent of Gemini) |
| C4 | H26 | MC live; stalled-task recommendation accept updates all clients | Drop rules v2 and agent work; keep the stall rule only |
| C5 | H31 | RC tagged; demo seed reproducible from scratch in < 5 min | Demo from the Tiger fork snapshot plus the MC static mock fallback |

Each checkpoint has a 10-minute all-hands sync with a go/no-go on cuts. **Deploy to prod at least every 3 hours**; never deploy after H33 except for demo-blocking fixes.

## 6. Testing windows

- **Continuous:** engine unit tests (solver, CPM, rules, validators) written alongside the code, in agent prompts.
- **H24–26:** E2E happy path.
- **H28–31:** security tests (authZ matrix, webhook signature), responsive/a11y pass on the demo screens, webhook burst test (50 commits).
- **H31–33:** full demo dry run on production with real accounts; record timings.

## 7. Feature cutoffs (in this order, if behind)

1. **H18 behind:** cut P1 agents (Phase 6) entirely; D joins linking and MC.
2. **H22 behind:** cut inferred activity linking (keep confirmed `hk-` linking); cut S12 tables (keep the feed).
3. **H24 behind:** cut workload-imbalance and scope-cut rules; keep **stalled → reassign** only.
4. **H26 behind:** cut the idea-generation UI polish (single idea path); cut S5 visualizations (keep the coverage list).
5. **Never cut:** sign-in, invite, skill import with evidence, plan generation with feasibility, explainable assignment, live GitHub commit in MC, one adaptive recommendation.

## 8. Demo script (5 minutes) and fallbacks

| Time | Beat | What's shown | Differentiator |
|---|---|---|---|
| 0:00 | Problem | One sentence and the team photo | |
| 0:20 | Team joins | Invite link; three members' imported skills with evidence; one member confirms or edits | D1 |
| 1:00 | Constraints | Select the Hugging Face challenge, plus a deadline already filled in | D1 |
| 1:20 | Plan | Ideas → pick → plan streams in; feasibility banner shows cuts with numbers | D1 |
| 2:10 | **Same idea, different team** | Swap one member (prepared second workspace); stack and assignments change, and the explanation says why | D1 + D2 |
| 2:50 | Assignment | Open an explanation: score breakdown, alternatives; override and lock | D2 |
| 3:20 | Live | Teammate pushes to `hk-4-auth`; commit appears in MC in about 2s, linked as confirmed; Claude Code session flips to "awaiting input" (P1) | Live tracking |
| 4:00 | **Adaptive** | Stalled critical task, then a recommendation to reassign to an idle teammate (82% match); accept; card animates across lanes | D3 |
| 4:40 | Close | Sponsor tech callouts (HF Qwen3 embeddings, Tiger hypertables, Gemini structured planning); the line "It understands the team…" | |

**Fallbacks:**
- **Network or GitHub slow:** `scripts/demo-push.sh` pre-staged. If webhooks lag more than 10s, narrate and show the already-ingested event. The MC polling fallback is on.
- **Gemini down or slow:** the prompt-hash cache returns the rehearsed plan instantly (seeded). Template plan as a second layer.
- **HF down:** matching falls back to keyword/alias rules; skill fit still works, only semantic fit drops. The AI status panel shows it.
- **Total outage:** the Tiger fork demo workspace plus `?demo=1` static Mission Control, then the recorded backup video (made at H33).
- **The stall rule needs time to trigger:** the demo kit's `stall` switch backdates `started_at` and the last activity for the chosen task.

## 9. Pre-demo checklist (T-30 min)
- [ ] `/health/deep` green; HF and Gemini keys valid; keyword fallback tested
- [ ] Demo accounts signed in on two browsers plus a phone (MC mobile)
- [ ] Demo repo clean; `hk-4-auth` branch prepared locally; push script tested
- [ ] Claude Code session running with the Hakit plugin on the demo laptop
- [ ] Recommendation scenario reset; plan cache warm
- [ ] Backup video on local disk; slides open
- [ ] Notifications off; browser zoom 110%; dark-room contrast check
