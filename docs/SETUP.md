# Hakit — Setup Guide

## 1. Local development (no accounts needed)

```bash
nvm use            # Node 22+
corepack enable    # pnpm 10
pnpm install
cp apps/web/.dev.vars.example apps/web/.dev.vars   # HAKIT_MOCKS=1 by default
pnpm dev           # http://localhost:5173
```

You land on Mission Control with fixture data and a live WebSocket. Useful URLs:
- `/_ui` component gallery
- `/api/v1/health/deep` health checks
- `/login` sign-in screen

Before pushing, run `pnpm typecheck && pnpm lint && pnpm test`.

## 2. Shared dev database: Tiger Cloud (PL owner does this once)

1. Create a **free** service at https://console.cloud.timescale.com. Copy the **direct service URL**: database `tsdb`, `sslmode=require`. Don't use the transaction pooler (`tsdb_transaction`).
2. Write `packages/db/.env` (gitignored):
   ```
   DATABASE_URL=postgres://tsdbadmin:…@….tsdb.cloud.timescale.com:…/tsdb?uselibpqcompat=true&sslmode=require
   ```
   Keep `uselibpqcompat=true&`. Without it, node's `pg` driver treats `sslmode=require` as full certificate verification, which Tiger's certificate chain fails (`SELF_SIGNED_CERT_IN_CHAIN`). `drizzle-kit migrate` hides that error and only prints `Exit status 1`. psql rejects the parameter, so drop it for psql and Hyperdrive: `psql "${DATABASE_URL/uselibpqcompat=true&/}"`.
   If you `export`ed an older `DATABASE_URL` in your shell, `unset` it first: dotenv won't override a variable that's already set.
3. Run `pnpm db:migrate && pnpm db:seed`.
4. Check that `drizzle/0002_timescale.sql` applied cleanly: `select * from timescaledb_information.hypertables;` should list `activity_events`, and `timescaledb_information.continuous_aggregates` should list `activity_hourly`.
5. Share the URL with the team **privately**: a password manager or DM, never the repo or chat logs.
6. Create a **fork** named `hakit-preview` for preview deploys.

**Each developer:** to run against the real database instead of mocks, set `HAKIT_MOCKS=0` in `.dev.vars` and export:

```bash
export CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="postgres://…tiger dev URL…"
```

## 3. GitHub Apps (GH owner)

Create **two** apps under Settings → Developer settings → GitHub Apps: **Hakit** (production) and **Hakit Dev** (local).

| Field | Hakit Dev | Hakit |
|---|---|---|
| Homepage URL | `http://localhost:5173` | `https://<prod-host>` |
| Callback URL | `http://localhost:5173/api/v1/auth/github/callback` | `https://<prod-host>/api/v1/auth/github/callback` |
| Expire user authorization tokens | ✅ | ✅ |
| Request user authorization during installation | ❌ | ❌ |
| Setup URL (+ Redirect on update ✅) | `http://localhost:5173/api/v1/auth/github/setup` | `https://<prod-host>/api/v1/auth/github/setup` |
| Webhook URL | your tunnel URL + `/webhooks/github` (see below) | `https://<prod-host>/webhooks/github` |
| Webhook secret | `openssl rand -hex 32` | different value |

**Permissions:**
- Repository: Metadata (read), Contents (read), Pull requests (read)
- Account: Email addresses (read)

**Events:** Installation, Installation repositories, Repository, Push, Create, Delete, Pull request, Pull request review.

**Where it can be installed:** any account.

After creating each app:
- Generate a private key, then convert it to PKCS#8 for WebCrypto:
  ```bash
  openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt -in hakit.private-key.pem -out hakit.pkcs8.pem
  ```
- Copy the App ID, slug, client ID and a new client secret.

**Local webhooks:** `cloudflared tunnel --url http://localhost:5173` gives a public URL. Put it in the Hakit Dev webhook field. Quick tunnels change on restart; use a named tunnel for stability.

## 4. Cloudflare (PL owner)

```bash
npx wrangler login
npx wrangler hyperdrive create hakit-db --connection-string="<Tiger direct URL>"   # put the id in wrangler.jsonc
npx wrangler queues create hakit-jobs
npx wrangler queues create hakit-dlq
```

Then set the production secrets, one `wrangler secret put` per name (run from `apps/web`):

```bash
for s in SESSION_SECRET TOKEN_ENC_KEY GITHUB_APP_ID GITHUB_APP_SLUG GITHUB_CLIENT_ID GITHUB_CLIENT_SECRET \
         GITHUB_WEBHOOK_SECRET GITHUB_APP_PRIVATE_KEY GEMINI_API_KEY HF_TOKEN; do npx wrangler secret put $s; done
```

Deploy:

```bash
pnpm deploy
```

Afterwards, update `APP_URL` in `wrangler.jsonc` vars, and update the production GitHub App URLs to match.

**Plan:** start on Workers Free. Upgrade to Paid ($5) only if you hit the CPU (10 ms), subrequest (50) or queue (10k/day) limits (RISKS D-2).

**CI deploys** need these GitHub repo secrets:
- `CLOUDFLARE_API_TOKEN`, using the "Edit Cloudflare Workers" template
- `CLOUDFLARE_ACCOUNT_ID`

## 5. AI providers (IN owner)

| Provider | Steps | Secret |
|---|---|---|
| Gemini | https://aistudio.google.com → API key. Enable billing with a spend cap (D-6). Confirm the model IDs behind `gemini-flash-latest` / Flash-Lite | `GEMINI_API_KEY` |
| Hugging Face | Token with "Inference Providers" permission. PRO or prepaid credits needed (D-5). Check `Qwen/Qwen3-Embedding-0.6B` availability on the router | `HF_TOKEN` |
| Workers AI | Nothing to set up; it's the embedding fallback. For local dev it needs `wrangler login` + `HAKIT_REMOTE_BINDINGS=1 pnpm dev` | – |
| AMD (optional) | Only if an AMD challenge is confirmed. Set up the MI300X with vLLM (INTEGRATIONS §4) | `AMD_*` |

## 6. Branch protection (owner)

On `main`, require pull requests and passing status checks (the `ci` workflow), and disallow force pushes.
