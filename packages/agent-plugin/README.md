# Hakit Claude Code plugin

Opt-in session telemetry for your Hakit team (docs/INTEGRATIONS.md §6.1). Owner: GH (T-603).

- **Sent:** hook event name, session id, notification type, tool name, repo slug, branch, a hash of the cwd, timestamp.
- **Never sent:** prompts, transcripts, tool inputs, file contents.
- Disable with `HAKIT_TELEMETRY=0` or revoke the token in Hakit.

Distribution via a marketplace repo is part of T-603. Test the payload filter: `pnpm --filter @hakit/agent-plugin test`.
