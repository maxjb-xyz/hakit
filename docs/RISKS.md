# Hakit — Risks, Fallbacks & Open Decisions

Status: **Planning draft v1.** Likelihood (L) and impact (I) are rated H/M/L.

## 1. Technical & delivery risks

| ID | Risk | L | I | Mitigation | Fallback |
|---|---|---|---|---|---|
| **R-0** | **Knight Hacks IX is happening now (Oct 9–11, 2026).** Part of the 36h window has likely passed. | H | H | Decide immediately (D-1): build a reduced scope now, or target a later event with this plan intact | "Now" scope = planning + explainable assignment + live GitHub feed + stall recommendation |
| R-1 | Overall P0 scope (~133h after the demo cut) exceeds team capacity | H | H | Frozen contracts at H3; parallel workstreams; agent-driven development; cut order in HACKATHON §7 | Never-cut list guarantees the three differentiators |
| R-2 | GitHub App setup or webhook delivery problems (tunnel, signature, Setup URL) | M | H | Done at H0–2 by a dedicated owner; verified at C0/C2; `Hakit Dev` app for local | Cron polling of recent commits (1-min latency) |
| R-3 | GitHub App user token can't create repos for personal accounts | M | L | Default to the guided `github.com/new` flow | Same |
| R-4 | Commit authors not mappable (unlinked emails) | M | M | ID → noreply parse → alias table → "map author" UI | Show the raw author; still link to the task via branch |
| R-5 | Webhook delivery failures: GitHub does not auto-retry | L | M | Delivery ledger plus a cron redelivery sweep (3-day window) | Backfill job |
| R-6 | Hyperdrive ↔ Tiger quirks (stacked pooling, prepared statements, extension functions) | M | H | Direct service URL; verify at H1 with `time_bucket` through Hyperdrive | Direct `pg` connection over TLS from the Worker for the hackathon |
| R-7 | Tiger free-plan auto-pause or 750 MiB cap | L | M | Our data is tiny; ping via cron; verify pause behavior | Upgrade to paid; keep a fork |
| R-8 | Gemini free-tier rate limits (429) during plan fan-out or the demo | H | H | Paid key with a spend cap (D-6); concurrency 3; backoff; prompt-hash cache | Template plans; cached demo plan |
| R-9 | LLM output invalid or unrealistic (bad estimates, cycles, unknown skills) | M | H | Zod re-validation + repair retry; deterministic validators (DAG, capacity, coverage); per-epic generation keeps JSON small | Human edit; template plan |
| R-10 | Embedding provider availability (HF router provider for Qwen3, AMD droplet) | M | M | Same model on HF, AMD and Workers AI; circuit breaker; content-hash cache | Keyword/alias matching (skill_fit still works without embeddings; only semantic_fit drops) |
| R-11 | HF free account has no inference credits | H | M | HF PRO or prepaid credits (D-5) | Workers AI serves the same model (sponsor story weakens) |
| R-12 | AMD credits not approved in time | M | L | Apply immediately (D-8); AMD is optional | Skip the AMD path; mention it as roadmap |
| R-13 | Skill inference feels wrong or offensive ("you're a 2/5 at Python") | M | M | Show evidence, not judgments; confidence labels; member edits are final; levels hidden from teammates unless confirmed (D-11) | Member can hide any skill |
| R-14 | Workers CPU limits (free plan 10ms) on JSON-heavy routes or crons | M | M | Workers Paid (D-2) | – |
| R-15 | Real-time WS drops on venue Wi-Fi | M | M | Replay buffer by sequence number; polling fallback after 15s | Phone hotspot for the demo |
| R-16 | Long LLM calls cut off when the client disconnects | M | L | Stream SSE; persist partial sections; resume by re-fetching the plan | Regenerate |
| R-17 | Sponsor eligibility claims wrong (challenge wording unknown) | H | M | Check the Devpost Prizes tab and the Hackers Guide at H0; adjust the demo emphasis | Don't claim tracks we can't verify |
| R-18 | Design inconsistency from parallel UI work by multiple agents | M | M | Token-only styling rule; `packages/ui` components only; DESIGN §12 checklist; one FE owner reviews all UI PRs | Final H28–31 polish pass |
| R-19 | Contract churn breaks parallel streams | M | H | Freeze at H3; additive-only changes; contract owner (A) | – |
| R-20 | Demo-day stall rule needs real elapsed time | H | M | Demo kit "stall" switch to backdate | Narrate with a pre-staged recommendation |

## 2. Security & privacy risks

| ID | Risk | Mitigation |
|---|---|---|
| S-1 | OAuth token leakage | AES-GCM encryption at rest; never logged; installation tokens never stored; refresh rotation stored atomically |
| S-2 | Spoofed `installation_id` on the Setup URL | Verify through `GET /user/installations` with the user token |
| S-3 | Forged webhooks | HMAC-SHA256 on the raw body, constant-time comparison, reject before parse |
| S-4 | Cross-workspace data access | Membership middleware on all routes; authZ matrix test (T-702) |
| S-5 | Private code sent to AI providers | Public repos only by default; manifests, language stats and READMEs only; explicit consent toggle for private metadata; no source upload |
| S-6 | Agent telemetry over-collection | Opt-in tokens; payload minimized client-side (no prompts or inputs by default); revocable; visible "what we send" panel |
| S-7 | Prompt injection via idea text, README or commit messages | Inputs passed as labelled JSON data; outputs schema-validated; LLM outputs never trigger mutations without user acceptance |
| S-8 | Invite link abuse | Expiry, max uses, revocation; owner can remove members |
| S-9 | CSRF on cookie-auth API | SameSite=Lax plus a custom header requirement on mutations |

## 3. Unresolved decisions (need approval)

| ID | Decision | Options | Recommendation |
|---|---|---|---|
| **D-1** | **Which event is the target?** Knight Hacks IX is live now (Oct 9–11) | (a) Build now with the reduced "now" scope; (b) target a later 36h event with the full plan; (c) use Knight Hacks as a learning run and polish afterwards | Depends on the hours left: under 20h means (a) with the never-cut list only; otherwise the full HACKATHON plan |
| D-2 | Cloudflare Workers Paid ($5/mo) | Free vs Paid | **Paid** |
| D-3 | Tiger Cloud plan | Free vs paid | **Free**, upgrade if pause or limits bite |
| D-4 | Repo creation approach | Guided URL / App Administration:write / separate OAuth app | **Guided URL** for MVP; API only if verified and opt-in |
| D-5 | Hugging Face billing | HF PRO ($9/mo) or prepaid credits / Workers AI only | **HF PRO or credits** (needed for the sponsor story) |
| D-6 | Gemini billing | Free tier vs paid key with cap; Flash vs Pro for planning | **Paid key with a $20 cap, Flash for everything**; Pro optional for the outline only |
| D-7 | Embedding model | Qwen3-Embedding-0.6B (1024d) vs bge-small-en-v1.5 (384d) | **Qwen3-Embedding-0.6B** (same model on HF, AMD and Workers AI) |
| D-8 | Pursue the AMD track | Apply for credits now and run vLLM on MI300X vs skip | **Apply now**; implement only if approved by ~H8 |
| D-9 | Brand: logo concept, accent colour, display font | DESIGN §1–3 | Monogram + Indigo + Inter/Inter Tight |
| D-10 | Codex hook support (Codex is a sponsor) | P2 vs P1 stretch for the demo | **P1 stretch** after the Claude Code plugin |
| D-11 | Skill-level visibility to teammates | Everyone sees levels vs only confirmed vs only categories | **Teammates see confirmed skills and levels; inferred-only skills are visible only to the member** |
| D-12 | Team size and roles for the build | 2, 3, 4 or 5 people | Plan assumes **4 developers** (+ an optional designer) |
| D-13 | Domain | `hakit.dev` or another / `*.workers.dev` | workers.dev for the hackathon unless a domain is already owned |
| D-14 | Auto-status from PRs | Suggest-only vs auto with undo | **Auto with undo** for PR merged → done |
| D-15 | ElevenLabs | Skip vs Mission briefing (P2) | **Build only if the MLH ElevenLabs prize is confirmed** on Devpost and the team is ahead at H24 |

## 4. Verify-list results
*(to be filled at H0–2 per ARCHITECTURE §13 / T-008)*
`GET /api/v1/health/deep` on the deployed worker answers the Hyperdrive/`time_bucket`, GitHub App and HF rows directly.

| Item | Result | Date |
|---|---|---|
| Hyperdrive ↔ Tiger direct URL with `time_bucket` | | |
| `@google/genai` on Workers | | |
| HF router Qwen3-Embedding-0.6B availability and latency | | |
| GitHub App `POST /user/repos` | | |
| Knight Hacks IX challenge list (Devpost Prizes tab) | | |
| Tiger free-service auto-pause behavior | | |
