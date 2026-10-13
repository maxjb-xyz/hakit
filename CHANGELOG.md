# Changelog

All notable changes to Hakit. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/). Database migrations ship with each release and run automatically on deploy.

## [Unreleased]

## [0.1.0]

First release for self-hosting, after Knight Hacks IX.

### Added
- Deploy to Cloudflare button: one click creates the Worker, D1 database, queues and Durable Objects.
- `/setup`: creates the instance's GitHub App through GitHub's manifest flow and stores it encrypted.
- Per-workspace daily AI usage limits.
- Export your data and delete your account or workspace from Settings.
- AGPL-3.0 licence, contributor guide, security policy and issue templates.

### Changed
- AI runs on Cloudflare Workers AI (Llama 4 Scout and Qwen3 embeddings); Gemini and Hugging Face are optional fallbacks.
- The database moved from Postgres (Tiger Cloud via Hyperdrive) to Cloudflare D1.
- The public URL comes from the request; `APP_URL` is only needed behind a proxy.
- New workspaces default to a custom event; the Knight Hacks IX template stays available.
- Test sign-in needs an explicit `E2E_LOGIN_ENABLED=1`.
- GitHub App keys work in the PKCS#1 format GitHub downloads; `TOKEN_ENC_KEY` accepts any 32+ character secret.

### Fixed
- `pnpm run deploy` ran pnpm's built-in `deploy` command instead of the project script.

[Unreleased]: https://github.com/maxjb-xyz/hakit/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/maxjb-xyz/hakit/releases/tag/v0.1.0
