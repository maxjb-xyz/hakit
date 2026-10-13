# GitHub workstream: verification without writing code

T-401 accepts webhooks, T-402 connects repositories, and T-403 turns events into activity.
Local checks below require no GitHub App, database account, or code changes.

## 1. Run the automated checks

From the repository root:

```bash
pnpm --filter @hakit/web test:github
pnpm typecheck
pnpm lint
pnpm test
```

`test:github` prints the name of each GitHub test. Look for all tests passing and no `Failed` summary.
Read the cases about spoofed installations, nonmembers, duplicate deliveries and retries: those describe the behavior the backend must preserve.
The tests exercise real handlers with fake GitHub, database and Cloudflare bindings. They do not contact your team's shared database or prove the production infrastructure works.

## 2. Try the local API in mock mode

Make sure `apps/web/.dev.vars` has `HAKIT_MOCKS=1`. If the file does not exist, copy `.dev.vars.example` to `.dev.vars` first. Start the app:

```bash
pnpm dev
```

Leave that terminal running. Open `http://localhost:5173` and inspect the Code activity screen. It is currently a placeholder showing fixture data; the repository picker UI belongs to T-407.

In a second terminal, list the demo repository:

```bash
curl -i http://localhost:5173/api/v1/github/repos
```

Expected: HTTP **200**, with `team-orbit/hakit` in the JSON.

Try the connection endpoint with the demo project and repo:

```bash
curl -i -X POST \
  http://localhost:5173/api/v1/projects/20000000-0000-4000-8000-000000000001/repo \
  -H 'Content-Type: application/json' \
  -H 'X-Requested-With: hakit' \
  -d '{"repoId":987654321}'
```

Expected: HTTP **200**, with the demo repo. In mock mode this returns a fixture; it does not save a connection, contact GitHub or queue backfill.

Repeat with `-d '{"repoId":"not-a-number"}'`: expect **400** (invalid input).
Repeat the valid request without `-H 'X-Requested-With: hakit'`: expect **403** (mutation protection).
These failures are useful checks, not signs the feature is broken.

## 3. Verify against real infrastructure when ready

Prerequisites:

- T-006: GitHub App registered; its callback, setup and webhook URLs point to the intended app/tunnel.
- T-201: real sign-in, session loading, encrypted GitHub tokens and lazy refresh implemented by Platform. Those paths are still scaffold stubs.
- Platform's database migrations, Hyperdrive and queue bindings configured.
- `SESSION_SECRET` configured (at least 32 characters); `TOKEN_ENC_KEY` is a base64-encoded 32-byte AES key.
- T-404: WebSocket project-membership guard completed before using shared live dashboards.

With `HAKIT_MOCKS=0` and a real signed-in session, use the typed API client in the local browser console:

```javascript
const { api } = await import('/src/client/lib/api.ts');
const wid = 'YOUR_WORKSPACE_UUID';
const pid = 'YOUR_PROJECT_UUID';
const install = await api('installUrl', { query: { workspaceId: wid } });
location.assign(install.url);
```

This starts installation in the same browser, so it retains the security cookie. After GitHub returns to the Code screen, import the client again (the page navigation clears console variables) and run:

```javascript
const { api } = await import('/src/client/lib/api.ts');
const pid = 'YOUR_PROJECT_UUID';
const repos = await api('listRepos');
console.table(repos);
// Select the numeric id of your intended test repo from the table:
await api('connectRepo', { params: { pid }, body: { repoId: YOUR_NUMERIC_REPO_ID } });
await api('listActivity', { params: { pid } });
```

Use an existing test repo for this exercise. Backfill is queued by T-402, but its processor remains T-405, so existing historical activity will not yet be imported.

Create a small commit on that repo through GitHub's web editor. Check GitHub App settings → Advanced → Recent deliveries: a new push should receive **202**. Check `listActivity` again: the commit should appear once. Redeliver the same successful webhook: expect **200**, and the commit count must stay the same.

Remove the repo from the App's selected repositories and check `/github/repos`: it should disappear. A second user who is not a project member must receive **404** when accessing that project's activity or attempting a connection.
Once T-404 is ready, keep two browsers open and verify a new commit reaches both through WebSockets.

## Platform integration note

`apps/web/src/worker/lib/github-token.ts` provides AES-GCM helpers. Token storage is a 12-byte random IV followed by ciphertext including the authentication tag, stored as `bytea`. T-201 must use this envelope or provide a compatible replacement reader. Expired/missing tokens currently return **401**; atomic refresh remains T-201.

GitHub installations are verified through the user's `/user/installations` listing, not trusted from the return URL. Discovery uses the user's `/user/installations/{id}/repositories` endpoint, so an App installation alone is not enough to expose a repo to that user. See [GitHub setup URL guidance](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-setup-url) and [installation API documentation](https://docs.github.com/en/rest/apps/installations).
