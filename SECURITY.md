# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub: on this repository, open **Security → Report a vulnerability**. Don't open a public issue or pull request for a security problem.

Include what you found, how to reproduce it, and the impact you expect. We'll acknowledge the report, keep you updated while we work on a fix, and credit you in the advisory unless you'd rather we didn't.

## Supported versions

Fixes land on `main` and in the next release. Self-hosted instances should stay on the latest release (see [`CHANGELOG.md`](CHANGELOG.md)); updating your copy of the repo redeploys and migrates automatically.

## Scope

In scope: the worker (`apps/web/src/worker`), the web client, the D1 schema and migrations, the `/setup` flow, webhook handling, and the Claude Code plugin (`packages/agent-plugin`).

Out of scope: issues in Cloudflare, GitHub or other third-party services themselves, and problems that need a compromised Cloudflare account or leaked instance secrets (`SESSION_SECRET`, `TOKEN_ENC_KEY`).
