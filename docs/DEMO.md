# Hakit — Demo Kit (T-705)

A 4–5 minute click-path through the product, with what to say on each screen, how to prepare real mode, and what to do when something fails. It extends the beat sheet in [HACKATHON §8](./HACKATHON.md) with concrete clicks, commands and fallbacks.

There are two ways to run the demo:

| | Mock mode | Real mode |
|---|---|---|
| Setup | `HAKIT_MOCKS=1` in `apps/web/.dev.vars`, then `pnpm dev` | A deployment (or `pnpm dev` with `HAKIT_MOCKS=0`) pointed at a **Tiger fork** that has been seeded with `pnpm --filter @hakit/web demo seed` |
| Data | Fixtures from `packages/contracts/src/fixtures` (Team Orbit, Knight Hacks IX, HK-4 stalled) | Real rows; plan, tasks, assignments, commits and recommendations are produced live |
| AI | Mock LLM and embeddings; the plan streams the fixture plan | Gemini (plan and prose) and HF Qwen3 embeddings, with template and keyword fallbacks |
| Risk | None (no network) | Live services; see §5 |
| Use for | Rehearsal, the backup video, and any total outage | The judged demo |

Both modes use the same screens and URLs. The client addresses the fixture workspace and project IDs, which is why the real-mode seed creates the demo workspace with exactly those IDs.

---

## 1. Click-path (target 4:30, hard stop 5:00)

URLs below are relative to `/w/<workspace>/`. In mock mode, `/` redirects to Mission Control.

| Time | Screen (DESIGN §8) | Click-path | Talking points |
|---|---|---|---|
| 0:00 | **Mission Control** (S11) `mc` | Open on MC. Don't click yet. | "Hackathon teams lose the first and last six hours to coordination. Hakit is the team OS: it knows who is on your team and what to build next." |
| 0:20 | **Team** (S5) `team`, then a **member profile** (S4) `team/<uid>` | Open Team, then Priya's profile. Point at a skill chip and its evidence ("wrangler in package.json"). Confirm one inferred skill. | "Skills are inferred from public GitHub evidence, each with a confidence score, and every member confirms them. Inferred and confirmed are labelled differently." (D1) |
| 1:00 | **Plan → Constraints** (S7) `plan?step=constraints` | Select the Hugging Face challenge. The deadline is already filled in from the Knight Hacks IX template. | "Sponsor requirements are inputs to the plan, not an afterthought." |
| 1:15 | **Plan → Idea** (S6) `plan?step=idea` | Click **Generate ideas**. Point at the team-fit meter on each card. Pick one. | "Ideas are grounded in this team's skills. The fit score is computed by the engine; the model only proposes." |
| 1:40 | **Plan → Plan review** (S8) `plan?step=plan` | Generate the plan. Let it stream: outline, then epics, then validation. Point at the feasibility banner and its numbers (required vs available hours, cut tasks). | "Every plan goes through deterministic validators: dependency graph, skill grounding, capacity with a 30% integration buffer, schedule, sponsor challenges and required deliverables. If it doesn't fit, scope gets cut, and the banner says how much." (D1) |
| 2:10 | **Same idea, different team** | Real mode: run `demo swap` (§4) and regenerate. Mock mode: narrate over the second plan version. | "Same idea, different team. Swap the React lead for an ML engineer, and the stack and assignments change. The coverage diff explains why." This is tested in the planning evals (T-703). (D1 + D2) |
| 2:50 | **Plan → Assign** (S9) `plan?step=assign` | Run the solver. Open one explanation: score breakdown, two alternatives with deltas. Override one assignment and lock it. Accept. | "Assignments are solved, not guessed: skill fit, load balance, continuity, availability, critical path. Every pick is explainable, and locks survive re-solves." (D2) |
| 3:20 | **Mission Control** `mc`, then **Code** (S12) `code` | Run `scripts/demo-push.sh` (§4). The commit appears in the activity feed within a few seconds, with a solid "confirmed" link to HK-4. Open Code to show the linked branch. | "Commits, PRs and agent sessions stream in over WebSockets. A branch named `hk-4-…` is a confirmed link; anything else is an inferred, dashed link with one-click confirm." |
| 3:45 | **Agents** (S13) `agents` (optional, P1) | Show a Claude Code session flip to "awaiting input". | "Teams now run coding agents. Hakit sees which task each session maps to, and when one is stuck." |
| 4:00 | **Mission Control**: recommendations | Real mode: `demo stall 4` beforehand (§4); the recommendation appears on the next evaluation (≤ 2 min). Open it, read the signals, click **Accept**. The card moves across lanes. | "HK-4 is on the critical path and has gone quiet. Hakit recommends a reassignment to an idle teammate, with the measured signals. Accepting applies it in one transaction." (D3) |
| 4:30 | Close | ⌘K: type `HK-4` to show the palette, then back to MC. | "Gemini structured planning, Hugging Face Qwen3 embeddings, Tiger hypertables for activity. It understands the team, plans to their strengths, and repairs the plan as reality changes." |

Keyboard path for the shell: **⌘K / Ctrl-K** opens the palette (screens, `HK-n` tasks, people, actions); `?` shows the shortcuts. The task inspector opens from any `HK-n` link.

## 2. What to point at on each screen

- **Measured vs estimated:** progress is measured; finish forecasts carry `≈`. Say it once on MC.
- **Confirmed vs inferred:** links and skills both show the distinction. Point at one of each.
- **Explanations:** every number on S9 and in a recommendation comes from the engine. LLM output is never the decision (AI.md).
- **Status without colour:** each health state has an icon and a label as well as a colour (DESIGN §12).

## 3. Mock-mode run (rehearsal and backup video)

```bash
cp apps/web/.dev.vars.example apps/web/.dev.vars   # HAKIT_MOCKS=1
pnpm install && pnpm dev                          # http://localhost:5173
```

- You're signed in as Priya (owner). The fixture scenario is about 14h into Knight Hacks IX, with HK-4 (GitHub OAuth) stalled on the critical path, so the recommendation beat works with no setup.
- The plan flow streams the fixture plan, and the mock LLM returns the fixture idea.
- The live beats (commit, agent flip, stall) are pre-baked in the fixtures. Narrate them as "what you'd see live".
- Record the backup video from this mode at 1440×900 with browser zoom at 110% (HACKATHON §9).

## 4. Real-mode preparation

### 4.1 Database: a Tiger fork, never the shared dev DB

1. In the Tiger console, fork the dev service, for example as `hakit-demo`. Copy the fork's direct connection string.
2. Apply migrations to the fork. The PL owner runs `pnpm db:migrate` with `DATABASE_URL` pointing **at the fork**.
3. Point the app at the fork. Either give the demo deployment its own Hyperdrive config for the fork, or run locally with `HAKIT_MOCKS=0` and `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=<fork url>` (SETUP §3).
4. The presenter signs in once through GitHub on that deployment, which creates their user row.

### 4.2 Seed, swap, stall, reset

`apps/web/scripts/demo/cli.ts` reuses the taxonomy and Knight Hacks IX seeds from `packages/db/src/seed`. It reads only `DEMO_DATABASE_URL`, refuses to run when that equals `DATABASE_URL`, and needs `DEMO_FORK_CONFIRM=yes`.

```bash
export DEMO_DATABASE_URL='postgres://…hakit-demo…'   # the FORK
export DEMO_FORK_CONFIRM=yes

pnpm --filter @hakit/web demo seed --owner <your-github-login>
#  → skills + Knight Hacks IX (idempotent), then a fresh "Team Orbit (demo)" workspace with the
#    fixture IDs, four teammates with skills/profiles, you as owner, and an empty "Hakit" project.
#    The event started 14h ago and the deadline is 22h from now, whenever you run it.

pnpm --filter @hakit/web demo swap      # Sam (React 5) ⇄ Dara (PyTorch 5, HF 4): "same idea, different team"
pnpm --filter @hakit/web demo stall 4   # HK-4 → in progress, started_at backdated past the stall threshold
pnpm --filter @hakit/web demo reset     # drop the demo workspace and seeded teammates
```

Re-running `seed` resets first, so it is also the "start over" button between rehearsals. `stall` only works after a plan has been accepted (it needs HK-n tasks). The stalled rule fires on the next `recs.evaluate` run, which happens on the 2-minute cron or after any board change. Make sure the task has an assignee who is currently available, and no linked activity newer than the backdated start.

The seed is covered by `apps/web/scripts/demo/seed.test.ts`, which runs against in-memory Postgres with the real migrations.

### 4.3 Scripted commits

```bash
scripts/demo-push.sh ~/demo/orbit 4 auth 2          # 2 commits on hk-4-auth, "HK-4: …", pushed
DRY_RUN=1 scripts/demo-push.sh ~/demo/orbit 4 auth  # rehearse without pushing
```

Run it in a clone of the **demo project's** repo (the one connected on S14 Settings), not in the Hakit repo. The script refuses to run in the Hakit repo or a dirty tree.

### 4.4 Pre-demo checklist (T-30 min; HACKATHON §9)

- [ ] `/health/deep` is green. Settings → AI status shows Gemini and HF healthy.
- [ ] `demo seed` has been re-run. There is no prompt-hash plan cache yet (AI.md §B.4 is not implemented), so time one live plan generation in the dry run.
- [ ] The demo repo is connected on Settings, the `hk-4-auth` branch is ready, and `DRY_RUN=1 demo-push.sh` has been tested.
- [ ] A Claude Code session is running with the Hakit plugin and an agent token (P1 beat).
- [ ] Mock mode runs on a second port as a hot spare: `HAKIT_MOCKS=1 pnpm dev --port 5174`.
- [ ] The backup video is on local disk. Notifications are off. Browser zoom is at 110%.

## 5. Fallbacks

| Failure | Detect | Do |
|---|---|---|
| Gemini slow or down | Plan stream stalls; Settings → AI status | Keep talking. The pipeline falls back to an editable **template plan** and labels it. Say "the template keeps the selected idea and challenges, and the team edits from there." |
| HF embeddings down | AI status shows keyword fallback | Nothing to do. Skill fit still works; only the semantic part drops, and the panel says so. |
| Webhook lag > 10s | Commit not in feed | Narrate, then show the already-ingested event in Code. The MC polling fallback catches up. |
| WebSocket blocked by venue network | MC shows "Reconnecting · updating every 10s" | Continue. The client falls back to polling. |
| Stall rec not showing | No card after 2 min | Re-run `demo stall 4`, or edit any task to trigger a board-change evaluation. Otherwise switch to `mc?demo=1`. |
| Real mode unusable | Any blocker | Open **`/w/<id>/mc?demo=1`** (also ⌘K → "Open Mission Control demo data"). It renders the fixture snapshot. Or switch to the mock-mode spare on :5174. |
| Total outage (no network) | — | Play the backup video from local disk. |

## 6. Verified so far

- Offline: `pnpm test` covers the plan pipeline evals (T-703), the demo seed, and every endpoint's mock fixture.
- **Not yet verified live:** a full real-mode run against a fork (needs T-002/T-003/T-006 setup), webhook latency on venue Wi-Fi, and the plugin's marketplace install (T-603). Record the timings from the first dry run here.
