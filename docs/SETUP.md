# Hakit — Setup Guide

## 1. Local development (no accounts needed)

```bash
nvm use            # Node 22+
corepack enable    # pnpm 10
pnpm install
pnpm dev           # http://localhost:5173, mock mode
```

`pnpm dev` runs in mock mode: fixture data, a fake signed-in user, and mock AI and GitHub. You land on Mission Control with a live WebSocket. Useful URLs:
- `/_ui` component gallery
- `/api/v1/health/deep` health checks
- `/login` sign-in screen

Local settings and secrets go in `.dev.vars` at the repo root (copy `.dev.vars.example`; it's gitignored). Before pushing, run `pnpm typecheck && pnpm lint && pnpm test`.

## 2. Deploy your own

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/maxjb-xyz/hakit)

1. Click the button. Cloudflare copies the repo to your GitHub account and creates the Worker, the D1 database, the queues and the Durable Object, with Workers AI bound. Every deploy applies pending D1 migrations first.
2. When it asks for `SESSION_SECRET` and `TOKEN_ENC_KEY`, give each a different random string of 32 or more characters (`openssl rand -base64 32` works). Keep `SESSION_SECRET` handy for step 4.
3. Open the Worker's URL and choose **Continue with GitHub**. A fresh instance has no GitHub App yet, so this takes you to `/setup`.
4. Paste `SESSION_SECRET` as the setup key (it proves you deployed this instance), optionally name a GitHub organization to own the App, and choose **Create GitHub App**. GitHub shows the App it's about to create, pointed at your URL; confirm it.
5. Back on `/setup`, continue to sign in, create your workspace, and install the App on your repos from the workspace when Hakit asks.

The App's credentials are stored in D1, encrypted with `TOKEN_ENC_KEY`. To start GitHub setup over, delete them and redeploy: `npx wrangler d1 execute hakit --remote --command "delete from instance_settings where key = 'github_app'"`. Changing `TOKEN_ENC_KEY` also makes `/setup` available again, and signs everyone out of GitHub.

The public URL is the origin requests arrive on. If the Worker sits behind another hostname or proxy, set `APP_URL` in `wrangler.jsonc` `vars`.

**Updates:** pull upstream changes into your copy of the repo; Cloudflare redeploys and migrates on push.

## 3. Database: Cloudflare D1

Hakit stores everything in one D1 database, bound as `DB` in `wrangler.jsonc` (repo root). Migrations live in `packages/db/migrations`; `0002_seed.sql` seeds the skills taxonomy and event templates.

**Local real mode:** set `HAKIT_MOCKS=0` in `.dev.vars`, then create the local database:

```bash
pnpm db:migrate    # wrangler d1 migrations apply DB --local
pnpm dev
```

The local database lives in `apps/web/.wrangler/state`; delete that folder to start over. Real mode calls your account's Workers AI, so run `npx wrangler login` first. GitHub sign-in works locally too: open `http://localhost:5173/setup` (put a 32+ character `SESSION_SECRET` and `TOKEN_ENC_KEY` in `.dev.vars` first). Tests never use the local database: they run on an in-memory D1 (`@hakit/db/testing`).

**Schema changes:** edit `packages/db/src/schema.ts`, run `pnpm db:generate`, then `pnpm db:migrate`.

## 4. Manual deploy

Without the button, from the repo root:

1. `npx wrangler login`
2. Create the database and queues. Wrangler finds the database by its name, `hakit`, so there's no ID to copy.
   ```bash
   npx wrangler d1 create hakit
   npx wrangler queues create hakit-jobs
   npx wrangler queues create hakit-dlq
   ```
3. `pnpm run deploy` applies pending D1 migrations to the remote database, builds and deploys. (Plain `pnpm deploy` is a different, built-in pnpm command.)
4. Secrets: `npx wrangler secret put SESSION_SECRET` and `npx wrangler secret put TOKEN_ENC_KEY` (32+ random characters each). Then follow steps 3 to 5 of §2.
5. CI deploys: Cloudflare API token with Workers Scripts, D1, Queues and Workers AI edit permissions; GitHub repo → Environments → `production`; Actions secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`; Actions variable `DEPLOY_ENABLED=true`.

## 5. GitHub App

`/setup` (§2) creates the App for you. It's public (invite links need that: "Only on this account" makes GitHub 404 the sign-in page for everyone but the owner), reads Contents, Metadata and Pull requests, reads members' email addresses, and subscribes to Create, Delete, Pull request, Pull request review, Push and Repository events. Locally the webhook is created inactive, since GitHub can't reach localhost.

To use an App you made by hand instead, create one with those settings, callback URL `<url>/api/v1/auth/github/callback`, setup URL `<url>/api/v1/auth/github/setup` (redirect on update on), webhook URL `<url>/webhooks/github` and "Expire user authorization tokens" on. Then set `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_WEBHOOK_SECRET` and `GITHUB_APP_PRIVATE_KEY` as secrets (or in `.dev.vars`, with the key on one line: `awk '{printf "%s\\n", $0}' key.pem`). The key can stay in the format GitHub downloads. Values set this way take precedence over `/setup`.

**Local webhooks:** copy real payloads from the Hakit app's Advanced → Recent Deliveries into fixtures and replay them:
```bash
SIG=$(openssl dgst -sha256 -hmac "$GITHUB_WEBHOOK_SECRET" < push.json | sed 's/^.* //')
curl -X POST http://localhost:5173/webhooks/github -H "Content-Type: application/json" \
  -H "X-GitHub-Event: push" -H "X-GitHub-Delivery: $(uuidgen)" -H "X-Hub-Signature-256: sha256=$SIG" \
  --data-binary @push.json
```

### Your data

Everything lives in your own D1 database. Per user Hakit stores: the GitHub profile (id, login, name, avatar, email), the GitHub user token (AES-GCM encrypted with `TOKEN_ENC_KEY`), sessions (only a SHA-256 of the cookie), workspace memberships and profiles, inferred and confirmed skills with their evidence (repo languages, dependencies, topics), assignments and task changes, GitHub activity attributed to them (commit, branch and PR metadata, never code), and, only if they install the Claude Code plugin, agent token hashes and session telemetry (status, repo and branch if shared, prompts only when turned on per token).

Anyone can manage this in **Settings → Your data**:
- **Export my data** (`GET /api/v1/me/export`) downloads it all as JSON. Token hashes, encrypted tokens and session ids are left out.
- **Delete my account** (`DELETE /api/v1/me`) removes the user and their personal data (sessions, GitHub token, agent tokens and sessions, profiles, skills and evidence, memberships, their Claude Code telemetry). Team data stays on the board without their name: tasks, task history, plans and GitHub activity keep existing with the reference cleared. Workspaces where they were the only member are deleted; a sole owner of a team must transfer ownership or delete the workspace first.

Owners also get **Settings → Danger zone → Delete workspace** (`DELETE /api/v1/w/:wid`, typing the workspace name to confirm), which deletes its projects, plans, tasks, activity, recommendations, repo connections, invites and agent sessions. GitHub installations and repo metadata are instance-wide and stay; uninstall the App on GitHub to remove them from GitHub's side.

## 6. AI providers

Hakit uses **Workers AI** through the `AI` binding in `wrangler.jsonc`: `AI_MODEL_PLAN` / `AI_MODEL_FAST` for plans, ideas and explanations, and `@cf/qwen/qwen3-embedding-0.6b` for embeddings. No key or secret is needed; usage is billed to the Cloudflare account (the free plan includes a daily allowance). In local real mode the binding calls your account, so run `npx wrangler login` first. Mock mode never calls it.

Optional fallbacks, used only when set. The router tries Workers AI first.

| Provider | Steps | Secret |
|---|---|---|
| Gemini | https://aistudio.google.com → API key. Model IDs default to `gemini-flash-latest` / `gemini-flash-lite-latest` (override with `GEMINI_MODEL_PLAN` / `GEMINI_MODEL_FAST`) | `GEMINI_API_KEY` |
| Hugging Face | Token with "Inference Providers" permission. Serves the same `Qwen/Qwen3-Embedding-0.6B` model, so vectors stay compatible | `HF_TOKEN` |

Live checks outside the worker (`pnpm --filter @hakit/web check:llm`, `eval:planning`, `check:embeddings`) call Workers AI over REST when `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` (a token with Workers AI read and edit) are in `.dev.vars`, and otherwise fall back to the Gemini or Hugging Face keys.

## 7. What the free plan covers

Hakit runs on the Workers Free plan for a small team. The limits that matter:

| Resource | Free plan | What uses it |
|---|---|---|
| Workers | 100,000 requests/day, 10 ms CPU per request | API, WebSockets, webhooks. Large boards can approach the CPU limit when solving assignments. |
| Queues | 10,000 operations/day | Recommendation checks every 2 minutes per active project, embeddings, GitHub backfill, agent events. About three active projects fit (each check costs about 3 operations). |
| D1 | 5M rows read and 100,000 written per day, 5 GB | Everything. |
| Workers AI | 10,000 neurons/day | Ideas, plans, explanations, embeddings. Roughly 15 plan generations a day plus the small calls (estimated from Llama 4 Scout pricing). |
| Durable Objects | SQLite-backed, 100,000 requests/day | Live project rooms. |

The Workers AI allowance belongs to the whole Cloudflare account, so one busy workspace could use it up for
everyone. `AI_DAILY_LIMIT_PER_WORKSPACE` (a `vars` entry in `wrangler.jsonc`, default `300`) caps each workspace
per UTC day, in AI units: a plan-tier call (ideas, plan outline, epic tasks, repair) is 10, a fast-tier call
(assignment explanations) 2, and an embedding request that misses the cache 1. One unit is roughly 15 neurons,
so 300 is under half the free allowance, about six plan generations plus the small calls. Over the limit,
Hakit behaves as if the provider were rate limited until 00:00 UTC: template plans and explanations, keyword
skill matching, and "enter your own idea" for ideas. Settings → AI providers shows today's usage. Set it to
`"0"` (or remove it) for no limit, for example on Workers Paid. Skill taxonomy embeddings, skill search and the
deep health check are not tied to a workspace and are not counted.

Workers Paid ($5/month) lifts all of these well past what a hackathon needs; switch if `/api/v1/health/deep` or the dashboard shows errors from limits.

## 8. Branch protection

On `main`, require pull requests and passing status checks (the `ci` workflow), and disallow force pushes.
