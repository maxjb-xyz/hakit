#!/bin/sh
# Hakit hook emitter (docs/INTEGRATIONS.md §6.1). Reads the hook JSON on stdin, keeps ONLY allow-listed
# fields, adds repo/branch, POSTs to Hakit. Always exits 0 so it can never break a Claude Code session.
# Env: CLAUDE_PLUGIN_OPTION_HAKIT_TOKEN, CLAUDE_PLUGIN_OPTION_ENDPOINT (from plugin userConfig),
#      or HAKIT_TOKEN / HAKIT_ENDPOINT (manual install). HAKIT_TELEMETRY=0 disables. HAKIT_DRY_RUN=1 prints instead of sending.
[ "${HAKIT_TELEMETRY:-1}" = "0" ] && exit 0
TOKEN="${CLAUDE_PLUGIN_OPTION_HAKIT_TOKEN:-${HAKIT_TOKEN:-}}"
ENDPOINT="${CLAUDE_PLUGIN_OPTION_ENDPOINT:-${HAKIT_ENDPOINT:-}}"
{ [ -z "$TOKEN" ] || [ -z "$ENDPOINT" ]; } && exit 0
command -v jq >/dev/null 2>&1 || exit 0
command -v curl >/dev/null 2>&1 || exit 0

INPUT=$(cat)
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
REPO=""; BRANCH=""; CWD_HASH=""
if [ -n "$CWD" ] && [ -d "$CWD" ]; then
  REMOTE=$(git -C "$CWD" remote get-url origin 2>/dev/null)
  REPO=$(printf '%s' "$REMOTE" | sed -E 's#(\.git)?$##; s#^.*[:/]([^/]+/[^/]+)$#\1#')
  BRANCH=$(git -C "$CWD" rev-parse --abbrev-ref HEAD 2>/dev/null)
  CWD_HASH=$(printf '%s' "$CWD" | { sha256sum 2>/dev/null || shasum -a 256; } | cut -c1-16)
fi
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

BODY=$(printf '%s' "$INPUT" | jq -c --arg repo "$REPO" --arg branch "$BRANCH" --arg cwdHash "$CWD_HASH" --arg ts "$TS" '{
  agent: "claude_code",
  hookEventName: .hook_event_name,
  sessionId: .session_id,
  ts: $ts,
  notificationType: (.notification_type // null),
  toolName: (.tool_name // null),
  repo: (if $repo == "" then null else $repo end),
  branch: (if $branch == "" then null else $branch end),
  cwdHash: (if $cwdHash == "" then null else $cwdHash end)
} | with_entries(select(.value != null))' 2>/dev/null) || exit 0

if [ "${HAKIT_DRY_RUN:-0}" = "1" ]; then printf '%s\n' "$BODY"; exit 0; fi
curl -sS -m 3 -o /dev/null -X POST "$ENDPOINT/api/v1/agent/events" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' --data-binary "$BODY" 2>/dev/null
exit 0
