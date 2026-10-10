# Hakit — Integrations

Status: **Planning draft v1.** Research date 2026-10-10. Confidence tags: **[confirmed]** comes from official source or docs, **[secondary]** comes from search summaries, **[verify]** must be checked in Phase 0.

## 0. Knight Hacks IX: what's actually confirmed

| Fact | Status |
|---|---|
| **Knight Hacks IX: Oct 9–11, 2026, UCF, 36 hours**, submissions via **Devpost** and **GitHub** required | [confirmed] (2026.knighthacks.org source, KnightHacks/forge repo) |
| Tracks: Hello World; AI/ML; App Development; Game Development; Embedded Software | [confirmed] |
| Judging: general and sponsor judges; rubric "in Hackers Guide" (not public to our research) | [confirmed] / rubric unknown |
| Sponsors include **Hugging Face (Gold), AMD (Gold), GitHub (Bronze), Figma (Bronze), Codex (Bronze)**, MLH (partner), plus Databricks, NVIDIA, AWS, Bloomberg, … | [confirmed] |
| **TigerData, ElevenLabs, Google/Gemini and Cloudflare are *not* on the sponsor list.** They can only matter via MLH prize categories | [confirmed absence from site] |
| MLH "Best Use of ElevenLabs" active through Q4 2026; "Best Use of Gemini API" listed through Q1 2026, may be renewed | [secondary] |
| 2026 sponsor challenge wording and prizes | **unknown**: check the Devpost Prizes tab (likely `knight-hacks-ix.devpost.com`) and the Hackers Guide |
| 2025 precedent: AMD ran "Best use of AMD Hardware/Software" ($7,240, 3 winners) | [secondary] |

**Implications:**
1. The highest-value sponsor targets are probably **Hugging Face, AMD and GitHub**, plus MLH Gemini and ElevenLabs if they are listed. **Codex** is a sponsor, which raises the priority of Codex hook support (P1 → consider for the demo).
2. TigerData and Cloudflare are chosen on **technical merit**, not prize eligibility. Keep them, since they're the right tools, but don't build features just to "use" them.
3. **The event is in progress today (Oct 10).** See RISKS R-0 and decision D-1.

---

## 1. GitHub (P0)

### 1.1 Why a GitHub App (not an OAuth App)
- One registration covers sign-in (user-to-server token), repo access (installation token) and **one app-level webhook**, with no per-repo hook setup. [confirmed]
- Fine-grained permissions. Users choose "All" or "Selected" repositories, so **signing in does not grant monitoring**: only installed repos are tracked.
- User tokens expire after 8h with a 6-month refresh token. A refresh invalidates the old pair, so the new pair must be stored atomically. [confirmed]

### 1.2 App registration (`Hakit` prod, `Hakit Dev` local)
- **Callback URL:** `{APP_URL}/api/v1/auth/github/callback`
- **Setup URL:** `{APP_URL}/api/v1/auth/github/setup`, with "Redirect on update" on
- **Request user authorization during installation:** **off**. We run our own web flow to control `redirect_uri` and `state`. Sign-in and install are separate steps in the UX: sign in first, install when connecting a repo.
- **Webhook URL:** `{APP_URL}/webhooks/github`. Secret is `GITHUB_WEBHOOK_SECRET`.
- **Expire user tokens:** on.

### 1.3 Permissions (minimal)

| Permission | Level | Needed for |
|---|---|---|
| Metadata | read (mandatory) | repo list, languages, topics, `repository` events |
| Contents | read | commits, branches, manifests and README for skill import on installed repos; `push`, `create`, `delete` events |
| Pull requests | read | PR tracking; `pull_request`, `pull_request_review` events |
| Issues | read | *(P2 sync only; omit in MVP to keep the install prompt light)* |
| Administration | write | **only if** repo creation via the App is chosen (D-4). Scary in the consent screen, so prefer the alternative below |
| Account: Email addresses | read | map commit emails to users |

**Webhook events:** `installation`, `installation_repositories`, `repository`, `push`, `create`, `delete`, `pull_request`, `pull_request_review`.

### 1.4 Onboarding flow (zero manual webhook config)
1. **Sign in.** `/auth/github/login` → GitHub authorize → callback → user plus session. Skill import uses the user token to read **public** repos (5,000 req/h per user, shared).
2. **Connect a repo** (Code screen or plan-accept step):
   - Hakit calls `GET /user/installations` and `GET /user/installations/{id}/repositories` and shows the repos already accessible.
   - If a repo isn't listed, the user clicks "Add repository on GitHub", which opens `https://github.com/apps/<slug>/installations/new?state=<nonce>`. The user picks repos and returns via the Setup URL with `installation_id` and `setup_action`.
   - **Verify** `installation_id` belongs to the user through `GET /user/installations`, because the query param is spoofable. [confirmed guidance]
   - The user picks the repo; Hakit stores `project_repos` and enqueues `github.backfill` (last 48h).
3. Webhooks start flowing immediately. There is no per-repo config.

### 1.5 Webhook processing
- Verify `X-Hub-Signature-256` (HMAC-SHA256 of the raw body) with WebCrypto, constant-time. Reject with 401 before parsing.
- Dedupe on `X-GitHub-Delivery` (insert into `webhook_deliveries` with `ON CONFLICT DO NOTHING`; if no row was inserted, return 200).
- Enqueue `github.webhook` and **respond 202 within 1s**. GitHub's timeout is 10s.
- **GitHub does not automatically retry failed deliveries.** The cron redelivery sweep (`GET /app/hook/deliveries` → `POST …/attempts`, 3-day window) covers outages. [confirmed]
- Normalization:

| Event | → `activity_events.kind` |
|---|---|
| `push` | one `commit` per commit (dedupe by sha) + `branch_created` if `created` |
| `create` / `delete` (ref_type=branch) | `branch_created` / `branch_deleted` |
| `pull_request` opened/closed/reopened/ready_for_review/synchronize | `pr_opened`, `pr_merged` (closed+merged), `pr_closed`, `pr_updated` |
| `pull_request_review` submitted | `pr_review` (state) |
| `installation*`, `repository` | update installations/repos (no activity) |

### 1.6 Repository creation (D-4)
Options, in order of preference:
- **A. Guided creation (recommended for the MVP):** Hakit opens `https://github.com/new?name=<suggested>&description=<pitch>&visibility=public` (GitHub's prefilled new-repo URL). After creation the user returns to Hakit. If the App is installed on "All repositories", the `repository.created` webhook makes the repo appear instantly; otherwise the user installs on it in one click. No scary permissions. [verify query params]
- **B. API creation:** `POST /user/repos` with the user token requires **Administration: write** on the App (also listed: `repository_creation` permission) [verify]. Community reports describe failures for personal accounts with App user tokens, so **test in Phase 0**. If it works, offer it as an opt-in "upgrade permissions" step.
- **C.** A separate OAuth App with the `public_repo` scope used only for creation. Not recommended (two consent screens).

Hakit can also push initial scaffolding (README with the plan, a `.github/pull_request_template.md` with an `HK-` reference field, and a `.claude/` folder with Hakit hooks). That needs Contents: write and is P2.

### 1.7 Author attribution
- Prefer the commit's `author.id` (REST) or `author.username` (push payload, present when GitHub resolved the email). Match on **numeric user ID**, not login.
- Parse noreply emails: `{id}+{login}@users.noreply.github.com`.
- Otherwise look up `author_aliases`. Unknown authors show in the "Map author" queue (S12) and the mapping is remembered.

### 1.8 Libraries on Workers
`@octokit/core` + `@octokit/plugin-rest-endpoint-methods` (fetch-based), `universal-github-app-jwt` (needs a **PKCS#8** key) and `@octokit/webhooks-methods` (WebCrypto). Signature verification is about 15 lines with `crypto.subtle` if preferred.

---

## 2. Hugging Face (P0, sponsor)

- **Role:** embeddings for capability matching, task–member relevance, activity–task linking and taxonomy normalization (see AI.md §A, §C, §2.2).
- **Model:** `Qwen/Qwen3-Embedding-0.6B` via `https://router.huggingface.co` (provider: DeepInfra) [secondary, verify availability with `hf models ls --pipeline-tag feature-extraction`]. Alternative: `BAAI/bge-small-en-v1.5` on `hf-inference` (default feature-extraction model, CPU serverless) [confirmed default].
- **Fallback categorization:** `facebook/bart-large-mnli` (zero-shot) on `hf-inference`.
- **Client:** `@huggingface/inference` v4 `InferenceClient` (fetch-based, runs on Workers) or raw `fetch`.
- **Billing:** free accounts get **no monthly Inference Provider credits**; PRO gets $2/mo. Our volume is tiny (< $1), but **a PRO account or prepaid credits is required** (D-5). [secondary/official pricing page]
- **Sponsor story:** "Hakit's team-intelligence engine runs on open-weight Hugging Face models. Every assignment explanation is grounded in Qwen3 embedding similarity between task requirements and GitHub-derived capability evidence." The AI status panel and the explanation inspector show the model name.

## 3. Gemini (P0)

- **SDK:** `@google/genai` `^2.28 <3` (fetch-based, ESM). Fallback is the raw REST `generateContent` / `streamGenerateContent`.
- **Models:** `gemini-flash-latest` (plan) and the Flash-Lite latest alias (fast); pin exact IDs after checking AI Studio. Gemini 2.5 is unavailable to new projects; Pro is paid-only [secondary].
- **Structured output:** `responseMimeType: application/json` plus `responseJsonSchema` (JSON Schema from Zod). Recursive `$ref` only in non-required properties. Re-validate with Zod.
- **Thinking:** `thinkingLevel` (MINIMAL/LOW/MEDIUM/HIGH) on 3.x; do **not** send `thinkingBudget`.
- **Streaming:** `generateContentStream`, relayed to the browser as SSE from the Worker (wall-clock time spent awaiting fetch does not count toward CPU limits).
- **Rate limits:** per project; the free tier is a few to about 15 RPM for Flash [secondary]. The plan fan-out (1 outline + about 5 epic calls) fits, but use a paid key for the demo (D-6).
- **MLH "Best Use of Gemini API"** is eligible if offered at Knight Hacks IX [verify on Devpost].

## 4. AMD (P1 sponsor showcase; optional for the MVP)

- **Reality check:** Cloudflare Workers have no GPU/ROCm execution. AMD compute must be an external endpoint.
- **Access:** the AMD AI Developer Program gives about $100 credits (about 50h of one MI300X at $1.99/h). A card is required, and approval was instant for some and took 2–3 days for others [secondary]. **Apply immediately** (D-8).
- **Setup (about 30 min):** an AMD Developer Cloud GPU droplet with the "vLLM Quick Start" image, then:
  ```bash
  docker exec -it rocm bash
  vllm serve Qwen/Qwen3-Embedding-0.6B --runner pooling --port 8001 &
  vllm serve Qwen/Qwen3-4B-Instruct-2507 --port 8000 --api-key $KEY &   # or similar small instruct model
  ```
  Front it with Caddy for TLS and a bearer token, or a Cloudflare Tunnel (`cloudflared`) so the Worker reaches it via a hostname. Alternative embedding server: HF TEI `rocm-latest` image (MI200/MI300 supported). Avoid TGI (maintenance mode).
- **Hakit usage:** set `AMD_LLM_BASE_URL`. The embedding router prefers AMD, and fast-tier prose (explanations, recommendation phrasing) uses the AMD instruct model. Mission Control's AI status shows "Embeddings: Qwen3-Embedding-0.6B on AMD Instinct MI300X".
- **Same model on AMD, the HF router and Workers AI** means vectors stay compatible and fallback is seamless. This is genuine use, not decoration.
- **Cost control:** stop the droplet when not demoing. Health check before the demo (pre-demo checklist).

## 5. TigerData / Tiger Cloud (P0, primary DB)

- **Plan:** free (2 services, shared compute, 750 MiB each, forks, TimescaleDB + pgvector + pgvectorscale + pgai) [secondary]. Upgrade to paid if auto-pause or storage becomes a risk (D-3) [verify auto-pause behavior for free services].
- **Connection:** Hyperdrive → **direct service URL** (`sslmode=require`), not the `tsdb_transaction` pooler, to avoid stacked transaction pooling [inference, verify]. Migrations run with drizzle-kit over the direct URL.
- **Capabilities used meaningfully:**
  1. **Hypertable `activity_events`.** Time-partitioned GitHub and agent events; fast "last N hours" queries for Mission Control and stall detection.
  2. **Continuous aggregate `activity_hourly`** (15-min buckets, real-time mode). Powers per-member and per-task activity sparklines, health and the stall rule (`last activity per task` from the aggregate plus the raw tail).
  3. **pgvector** (HNSW) for skills, tasks and member embeddings, so semantic matching happens in the same DB as relational constraints (`ORDER BY embedding <=> $1` joined with availability).
  4. **Forks** for preview environments and for a **demo snapshot**: fork the database with a prepared demo team for a reliable live demo (fallback procedure).
  5. *(P2)* compression and retention policies on `activity_events`.
- **Tiger MCP server** (`tiger mcp install`) can help developers with schema and query tuning during the build.

## 6. Coding agents (P1)

### 6.1 Claude Code (primary)
- **Distribution:** a Claude Code **plugin** `hakit` (in a marketplace repo `hakit/claude-plugins`). Install with `/plugin marketplace add <org>/hakit-plugins` then `/plugin install hakit`. `userConfig` asks for `hakit_token` (sensitive, stored in the keychain) and `endpoint`; hooks read them as `CLAUDE_PLUGIN_OPTION_*` env vars.
- **Fallback distribution:** a one-line installer that writes `hooks` into `.claude/settings.local.json` of the repo (per-repo opt-in) with the token in `~/.config/hakit/token` (chmod 600).
- **Hook events subscribed** (all `async: true` command hooks, `curl -m 3 … || true`, so they never block the agent):

| Hook | Derived status |
|---|---|
| `SessionStart` | session `active`; capture cwd → repo/branch (`git rev-parse` in the script) |
| `UserPromptSubmit` | `active` (clears awaiting) |
| `PreToolUse` / `PostToolUse` | `active`; tool name counted (sampled, max 1 event per 10s per session) |
| `Notification` with `notification_type` ∈ {`permission_prompt`, `idle_prompt`, `elicitation_dialog`, `agent_needs_input`} | `awaiting_input` |
| `PermissionRequest` | `awaiting_input` |
| `Stop` | `idle` (turn finished) |
| `StopFailure` | `error` |
| `SubagentStart` / `SubagentStop` | subagent count |
| `SessionEnd` | `ended` (explicit `timeout` since the SessionEnd budget is short) |

- **Payload minimization** (script with `jq`): send `hook_event_name`, `session_id`, `notification_type`, `tool_name`, repo slug (from `git remote`), branch, `cwd` hash and timestamp. **Never** prompts, transcript contents or tool inputs unless `share_prompts` is enabled for the token. Local kill switch: `HAKIT_TELEMETRY=0`.
- **Server:** `POST /api/v1/agent/events` (bearer `hk_at_…`), Zod-validated, enqueued, then the `agent_sessions` state machine, then a broadcast.
- **Consent:** off by default. A member creates a token on S13, which shows exactly what is sent. Teammates see sessions only for members who opted in. Revoking the token stops ingestion immediately.

### 6.2 Codex CLI (P1+, sponsor-relevant)
Codex has a hooks system (SessionStart, UserPromptSubmit, PreToolUse, PermissionRequest, PostToolUse, Stop, …; command hooks only; the user must trust them via `/hooks`) plus the legacy `notify` program on `agent-turn-complete` [secondary]. The same `emit.sh` script works with an adapter mapping. **Recommended as a stretch for the hackathon because Codex is a sponsor** (D-10).

### 6.3 Coder / Paperclip (post-hackathon)
- **Coder:** Tasks were deprecated (removed v2.37, Sept 2026) in favor of "Coder Agents". Integrate by running the Claude Code or Codex hooks inside Coder workspaces; no Coder-specific API is needed initially.
- **Paperclip:** an OSS agent-company control plane with heartbeats, activity events and webhook-triggered routines. A future adapter would ingest its activity feed and push Hakit tasks as Paperclip goals. Endpoints are unverified.

## 7. Figma (Phase 1 design tool, sponsor)
- Figma file "Hakit DS" with **variables** mirroring `tokens.css` (color, space, radius, type), components for the core primitives, and hi-fi frames for S3, S8, S9 and S11.
- **Figma Make** for fast clickable exploration in hours 0–3 (not production code).
- **Figma MCP server** (`claude mcp add --transport http figma https://mcp.figma.com/mcp`): engineers' Claude Code sessions pull `get_design_context` and variable definitions per frame. Free and Starter seats have very low MCP call limits, so **one paid Dev seat (trial)** is recommended [secondary].
- Tokens: code is the source of truth. Export Figma variables to DTCG JSON via a plugin (Tokens Studio / variables export) only if they diverge.
- Submission: link the Figma file in Devpost to show the design process.

## 8. ElevenLabs (P2; elevate only if the MLH category is confirmed)
- **SDK:** `@elevenlabs/elevenlabs-js` (officially supports Cloudflare Workers). Free tier about 10k credits/month, enough for demo briefings.
- **Workflow 1, "Mission briefing" (best fit, lowest effort):** a button on Mission Control. The Worker builds a structured status (deterministic), Gemini Flash-Lite writes a 45–60s script, then `eleven_flash_v2_5` TTS produces audio cached in **R2** (`briefings/{projectId}/{hash}.mp3`) and played in the UI. Can be scheduled every 6h.
- **Workflow 2, voice standup:** members record 30s, Scribe v2 speech-to-text transcribes it, Gemini extracts {done, doing, blockers} mapped to tasks, and the result appears as suggested status updates.
- Workflow 2 directly feeds Adaptive Execution, so it is the stronger product story but costs more to build.

## 9. Cloudflare services summary

| Service | Use | MVP? |
|---|---|---|
| Workers (+ static assets) | App and API | ✅ |
| Hyperdrive | Tiger Postgres pooling | ✅ |
| Durable Objects (SQLite, WS hibernation) | ProjectRoom real-time | ✅ |
| Queues | Webhook, agent and import jobs | ✅ |
| Cron Triggers | Adaptive tick, redelivery sweep | ✅ |
| Workers AI | Embedding fallback (same Qwen3 model) | ✅ (fallback) |
| R2 | Audio briefings and exports | P2 |
| Workers Rate Limiting binding | Agent endpoint rate limit | ✅ (small) |
| KV, D1, Vectorize, Workflows, Pages | not used | – |
