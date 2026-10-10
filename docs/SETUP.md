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
6. Create a **fork** named `hakit-preview`. The preview worker uses it (§3).

**Each developer:** to run against the real database instead of mocks, set `HAKIT_MOCKS=0` in `.dev.vars` and export:

```bash
export CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="postgres://…tiger dev URL…"
```

## 3. Cloudflare (PL owner)

Two deployed workers share one Cloudflare account:

| | Production | Preview |
|---|---|---|
| Worker | `hakit` | `hakit-preview` |
| Deploy | `pnpm deploy` (CI on `main`) | `pnpm deploy:preview` (manual) |
| Database | Tiger dev service | Tiger fork `hakit-preview` |
| Hyperdrive | `hakit-db` | `hakit-preview-db` |
| Queues | `hakit-jobs`, `hakit-dlq` | `hakit-preview-jobs`, `hakit-preview-dlq` |
| GitHub App | Hakit | Hakit Dev |

Local dev (`pnpm dev`) needs none of this. It uses `.dev.vars` and, with `HAKIT_MOCKS=0`, the Tiger dev URL directly.

1. `npx wrangler login`, then `npx wrangler whoami` and note the account ID.
2. Create the resources. Hyperdrive takes the Tiger URL **without** `uselibpqcompat=true&`:
   ```bash
   npx wrangler hyperdrive create hakit-db --connection-string="<Tiger dev URL>"
   npx wrangler hyperdrive create hakit-preview-db --connection-string="<Tiger fork URL>"
   npx wrangler queues create hakit-jobs
   npx wrangler queues create hakit-dlq
   npx wrangler queues create hakit-preview-jobs
   npx wrangler queues create hakit-preview-dlq
   ```
3. In `apps/web/wrangler.jsonc`, replace the two `000…0` Hyperdrive IDs: the top-level one with `hakit-db`, the one under `env.preview` with `hakit-preview-db`. Commit.
4. Set the non-GitHub secrets for both workers (from `apps/web`; each prompts for the value). Use fresh `openssl rand -base64 32` values per worker for `SESSION_SECRET` and `TOKEN_ENC_KEY`:
   ```bash
   for s in SESSION_SECRET TOKEN_ENC_KEY GEMINI_API_KEY HF_TOKEN; do
     npx wrangler secret put $s
     npx wrangler secret put $s --env preview
   done
   ```
   Missing secrets only turn their `/api/v1/health/deep` items red; they don't block a deploy.
5. Deploy both: `pnpm deploy && pnpm deploy:preview`. Note the two `*.workers.dev` URLs.
6. Put the URLs in `wrangler.jsonc`: `vars.APP_URL` (production) and `env.preview.vars.APP_URL`. Commit and deploy both again.
7. Check `https://<each host>/api/v1/health/deep`.
8. CI deploys (production only):
   - Cloudflare → My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" template.
   - GitHub repo → Settings → Environments → create `production`.
   - Settings → Secrets and variables → Actions: secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`; variable `DEPLOY_ENABLED` = `true`.

**Plan:** start on Workers Free. Upgrade to Paid ($5) only if you hit the CPU (10 ms), subrequest (50) or queue (10k/day) limits (RISKS D-2).

## 4. GitHub Apps (GH owner)

Two apps, no local tunnels. **Hakit** serves production. **Hakit Dev** serves local sign-in (callbacks to `localhost`) and sends its webhooks to the preview worker. Create both after §3 step 5, so the URLs exist.

Under GitHub → Settings → Developer settings → GitHub Apps → **New GitHub App**:

| Field | Hakit Dev | Hakit |
|---|---|---|
| Name (must be globally unique) | `Hakit Dev` | `Hakit` |
| Homepage URL | `http://localhost:5173` | `https://<prod-host>` |
| Callback URL | `http://localhost:5173/api/v1/auth/github/callback` | `https://<prod-host>/api/v1/auth/github/callback` |
| Expire user authorization tokens | ✅ | ✅ |
| Request user authorization (OAuth) during installation | ❌ | ❌ |
| Enable Device Flow | ❌ | ❌ |
| Setup URL | `http://localhost:5173/api/v1/auth/github/setup` | `https://<prod-host>/api/v1/auth/github/setup` |
| Redirect on update | ✅ | ✅ |
| Webhook active | ✅ | ✅ |
| Webhook URL | `https://<preview-host>/webhooks/github` | `https://<prod-host>/webhooks/github` |
| Webhook secret | `openssl rand -hex 32` | a different value |
| Where can it be installed | Any account | Any account |

To sign in to the **preview** worker, add `https://<preview-host>/api/v1/auth/github/callback` as a second callback URL on Hakit Dev. GitHub allows several.

**Permissions** (everything else "No access"):
- Repository: Contents (read), Metadata (read), Pull requests (read)
- Account: Email addresses (read)

**Events:** Create, Delete, Pull request, Pull request review, Push, Repository. Installation and Installation repositories events are always sent.

After creating each app, from its settings page:
1. Note the **App ID**, **Client ID** and **slug** (from `github.com/apps/<slug>`).
2. **Generate a new client secret.** It is shown once.
3. **Generate a private key** and convert it to PKCS#8 for WebCrypto:
   ```bash
   openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt -in <downloaded>.pem -out hakit.pkcs8.pem
   ```
4. Store everything in the password manager and delete the `.pem` files.

Then set the secrets (from `apps/web`):

```bash
# Hakit → production
for s in GITHUB_APP_ID GITHUB_APP_SLUG GITHUB_CLIENT_ID GITHUB_CLIENT_SECRET GITHUB_WEBHOOK_SECRET; do npx wrangler secret put $s; done
npx wrangler secret put GITHUB_APP_PRIVATE_KEY < hakit.pkcs8.pem
# Hakit Dev → preview
for s in GITHUB_APP_ID GITHUB_APP_SLUG GITHUB_CLIENT_ID GITHUB_CLIENT_SECRET GITHUB_WEBHOOK_SECRET; do npx wrangler secret put $s --env preview; done
npx wrangler secret put GITHUB_APP_PRIVATE_KEY --env preview < hakit-dev.pkcs8.pem
```

**Local `.dev.vars`:** use the Hakit Dev values. Keep `APP_URL=http://localhost:5173`. The private key goes on one line with `\n` escapes: `awk '{printf "%s\\n", $0}' hakit-dev.pkcs8.pem`. The key loader must accept both escaped and real newlines.

**Testing webhooks without a tunnel:**
- End to end: install Hakit Dev on a test repo, push, then check the app's Advanced → Recent Deliveries and `npx wrangler tail --env preview`.
- Locally: save payloads from Recent Deliveries as fixtures and replay them signed:
  ```bash
  SIG=$(openssl dgst -sha256 -hmac "$GITHUB_WEBHOOK_SECRET" < push.json | sed 's/^.* //')
  curl -X POST http://localhost:5173/webhooks/github -H "Content-Type: application/json" \
    -H "X-GitHub-Event: push" -H "X-GitHub-Delivery: $(uuidgen)" -H "X-Hub-Signature-256: sha256=$SIG" \
    --data-binary @push.json
  ```

## 5. AI providers (IN owner)

| Provider | Steps | Secret |
|---|---|---|
| Gemini | https://aistudio.google.com → API key. Enable billing with a spend cap (D-6). Confirm the model IDs behind `gemini-flash-latest` / Flash-Lite | `GEMINI_API_KEY` |
| Hugging Face | Token with "Inference Providers" permission. PRO or prepaid credits needed (D-5). Check `Qwen/Qwen3-Embedding-0.6B` availability on the router | `HF_TOKEN` |
| Workers AI | Nothing to set up; it's the embedding fallback. For local dev it needs `wrangler login` + `HAKIT_REMOTE_BINDINGS=1 pnpm dev` | – |
| AMD (optional) | Only if an AMD challenge is confirmed. Set up the MI300X with vLLM (INTEGRATIONS §4) | `AMD_*` |

## 6. Branch protection (owner)

On `main`, require pull requests and passing status checks (the `ci` workflow), and disallow force pushes.
