# Contributing to Hakit

Thanks for helping. Hakit is a small codebase with a few firm rules; they're all in [`CLAUDE.md`](CLAUDE.md), which is written for human and AI contributors alike. Read it before your first change.

## Getting started

```bash
corepack enable && pnpm install
pnpm dev        # http://localhost:5173 in mock mode: no accounts needed
```

Mock mode serves fixtures and fakes the signed-in user, so you can build any screen or engine function without Cloudflare or GitHub. For real mode locally, see [`docs/SETUP.md`](docs/SETUP.md).

## Making a change

1. Open an issue first for anything bigger than a bug fix, so we can agree on the approach.
2. Keep pull requests small and focused on one thing. Use the PR template.
3. Before pushing, run `pnpm format && pnpm typecheck && pnpm lint && pnpm test`. CI runs the same checks plus the Playwright suite in mock mode.
4. API changes start in `packages/contracts/src/api.ts`; database changes start in `packages/db/src/schema.ts` followed by `pnpm db:generate`. Never edit a migration that has shipped.
5. Note user-visible changes under **Unreleased** in [`CHANGELOG.md`](CHANGELOG.md).

## Licence

Hakit is licensed under the [GNU AGPL-3.0](LICENSE). By contributing, you agree that your contributions are licensed under the same terms.

## Security issues

Please don't open a public issue. See [`SECURITY.md`](SECURITY.md).
