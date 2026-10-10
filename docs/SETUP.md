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
6. Optional, later: fork the service as a demo snapshot (HACKATHON C5).

**Each developer:** to run against the real database instead of mocks, set `HAKIT_MOCKS=0` in `.dev.vars` and export:

```bash
export CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="postgres://…tiger dev URL…"
```

## 3. Cloudflare (PL owner)

One worker (`hakit`), one database (the Tiger dev service from §2). Run every `wrangler` command from `apps/web`.

1. `npx wrangler login`
2. Create Hyperdrive with the Tiger URL **including the password** but **without** `uselibpqcompat=true&`, then paste the printed ID over the `000…0` in `wrangler.jsonc`:
   ```bash
   npx wrangler hyperdrive create hakit-db --connection-string="postgres://tsdbadmin:<password>@<host>:<port>/tsdb?sslmode=require"
   ```
3. Create the queues:
   ```bash
   npx wrangler queues create hakit-jobs
   npx wrangler queues create hakit-dlq
   ```
4. `pnpm deploy`. Note the `https://hakit.<you>.workers.dev` URL, set it as `vars.APP_URL` in `wrangler.jsonc`, and deploy again.
5. Secrets: `npx wrangler secret put <NAME>` for `SESSION_SECRET` and `TOKEN_ENC_KEY` (each `openssl rand -base64 32`), then the GitHub values from §4 and the AI keys from §5 as they arrive. Missing secrets only turn their `/api/v1/health/deep` items red.
6. CI deploys: Cloudflare API token ("Edit Cloudflare Workers" template); GitHub repo → Environments → `production`; Actions secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`; Actions variable `DEPLOY_ENABLED=true`.

**Plan:** Workers Free. Upgrade to Paid ($5) only if you hit the CPU, subrequest or queue limits (RISKS D-2).

## 4. GitHub Apps (GH owner)

- **Hakit Dev**: local sign-in only. Webhooks **off**. Local webhook work replays signed fixtures (below). No tunnels.
- **Hakit**: production. Webhooks go to the deployed worker.

GitHub → Settings → Developer settings → GitHub Apps → **New GitHub App**:

| Field | Hakit Dev | Hakit |
|---|---|---|
| Homepage URL | `http://localhost:5173` | `https://<prod-host>` |
| Callback URL | `http://localhost:5173/api/v1/auth/github/callback` | `https://<prod-host>/api/v1/auth/github/callback` |
| Expire user authorization tokens | ✅ | ✅ |
| Request user authorization during installation | ❌ | ❌ |
| Setup URL (+ Redirect on update ✅) | `http://localhost:5173/api/v1/auth/github/setup` | `https://<prod-host>/api/v1/auth/github/setup` |
| Webhook | Active ❌ | Active ✅, URL `https://<prod-host>/webhooks/github`, secret `openssl rand -hex 32` |
| Where can it be installed | Any account | Any account |

**Permissions:** Repository: Contents, Metadata, Pull requests (all read). Account: Email addresses (read).
**Events** (Hakit): Create, Delete, Pull request, Pull request review, Push, Repository.

For each app: note the App ID, Client ID and slug; generate a client secret (shown once); generate a private key and convert it to PKCS#8:
```bash
openssl pkcs8 -topk8 -nocrypt -in <downloaded>.pem -out <name>.pkcs8.pem
```

- **Hakit values → production:** `npx wrangler secret put` for `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_WEBHOOK_SECRET`, and `npx wrangler secret put GITHUB_APP_PRIVATE_KEY < hakit.pkcs8.pem`.
- **Hakit Dev values → `apps/web/.dev.vars`.** Keep `APP_URL=http://localhost:5173`. Put the key on one line: `awk '{printf "%s\\n", $0}' hakit-dev.pkcs8.pem`. Pick any `GITHUB_WEBHOOK_SECRET` for fixture signing.

**Local webhooks:** copy real payloads from the Hakit app's Advanced → Recent Deliveries into fixtures and replay them:
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
