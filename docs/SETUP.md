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

## 2. Database: Cloudflare D1

Hakit stores everything in one D1 database, bound as `DB` in `apps/web/wrangler.jsonc`. Migrations live in `packages/db/migrations`; the last one seeds the skills taxonomy and event templates.

**Local real mode:** set `HAKIT_MOCKS=0` in `.dev.vars`, then create the local database:

```bash
pnpm db:migrate    # wrangler d1 migrations apply DB --local
pnpm dev
```

The local database lives in `apps/web/.wrangler/state`; delete that folder to start over. Tests never use it: they run on an in-memory D1 (`@hakit/db/testing`).

**Schema changes:** edit `packages/db/src/schema.ts`, run `pnpm db:generate`, then `pnpm db:migrate`.

## 3. Cloudflare

Run every `wrangler` command from `apps/web`.

1. `npx wrangler login`
2. Create the database and paste the printed `database_id` over the `000…0` in `wrangler.jsonc`:
   ```bash
   npx wrangler d1 create hakit
   ```
3. Create the queues:
   ```bash
   npx wrangler queues create hakit-jobs
   npx wrangler queues create hakit-dlq
   ```
4. `pnpm deploy` applies pending D1 migrations to the remote database, builds and deploys. Note the `https://hakit.<you>.workers.dev` URL, set it as `vars.APP_URL` in `wrangler.jsonc`, and deploy again.
5. Secrets: `npx wrangler secret put <NAME>` for `SESSION_SECRET` and `TOKEN_ENC_KEY` (each `openssl rand -base64 32`), then the GitHub values from §4. Workers AI needs no key (§5). Missing secrets only turn their `/api/v1/health/deep` items red.
6. CI deploys: Cloudflare API token with Workers Scripts, D1, Queues and Workers AI edit permissions; GitHub repo → Environments → `production`; Actions secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`; Actions variable `DEPLOY_ENABLED=true`.

**Plan:** Workers Free. Upgrade to Paid ($5) only if you hit the CPU, subrequest or queue limits (RISKS D-2).

## 4. GitHub Apps

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
| Where can it be installed | Any account | **Any account** (public). "Only on this account" makes GitHub 404 the sign-in page for everyone except the owner, so invite links break. |

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

## 5. AI providers

Hakit uses **Workers AI** through the `AI` binding in `wrangler.jsonc`: `AI_MODEL_PLAN` / `AI_MODEL_FAST` for plans, ideas and explanations, and `@cf/qwen/qwen3-embedding-0.6b` for embeddings. No key or secret is needed; usage is billed to the Cloudflare account (the free plan includes a daily allowance). In local real mode the binding calls your account, so run `npx wrangler login` first. Mock mode never calls it.

Optional fallbacks, used only when set. The router tries Workers AI first.

| Provider | Steps | Secret |
|---|---|---|
| Gemini | https://aistudio.google.com → API key. Model IDs default to `gemini-flash-latest` / `gemini-flash-lite-latest` (override with `GEMINI_MODEL_PLAN` / `GEMINI_MODEL_FAST`) | `GEMINI_API_KEY` |
| Hugging Face | Token with "Inference Providers" permission. Serves the same `Qwen/Qwen3-Embedding-0.6B` model, so vectors stay compatible | `HF_TOKEN` |

Live checks outside the worker (`pnpm --filter @hakit/web check:llm`, `eval:planning`, `check:embeddings`) call Workers AI over REST when `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` (a token with Workers AI read and edit) are in `apps/web/.dev.vars`, and otherwise fall back to the Gemini or Hugging Face keys.

## 6. Branch protection

On `main`, require pull requests and passing status checks (the `ci` workflow), and disallow force pushes.
