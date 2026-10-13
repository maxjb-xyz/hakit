# Hakit Claude Code plugin

Opt-in session telemetry for your Hakit team (docs/INTEGRATIONS.md §6.1). Owner: GH (T-603).

- **Sent:** hook event name, session id, notification type, tool name, repo slug, branch, a hash of the cwd, timestamp.
- **Never sent:** prompts, transcripts, tool inputs, file contents.
- Disable with `HAKIT_TELEMETRY=0` or revoke the token in Hakit.

**Install** in Claude Code:

```
/plugin marketplace add maxjb-xyz/hakit
/plugin install hakit@hakit
```

It asks for two values: an agent token (Hakit → Agents → Connect Claude Code) and your Hakit URL, the address of
your own instance (for example `https://hakit.<your-subdomain>.workers.dev`).

Test the payload filter: `pnpm --filter @hakit/agent-plugin test`.
