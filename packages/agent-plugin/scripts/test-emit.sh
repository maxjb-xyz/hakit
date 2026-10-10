#!/bin/sh
# Verifies emit.sh strips everything except allow-listed fields (no prompt, no tool_input, no transcript).
set -e
DIR=$(cd "$(dirname "$0")" && pwd)
OUT=$(printf '%s' '{"hook_event_name":"Notification","session_id":"s1","cwd":"/tmp","notification_type":"permission_prompt","prompt":"SECRET","tool_input":{"cmd":"rm"},"transcript_path":"/x"}' \
  | HAKIT_TOKEN=hk_at_x HAKIT_ENDPOINT=http://localhost HAKIT_DRY_RUN=1 sh "$DIR/emit.sh")
echo "$OUT" | grep -q '"hookEventName":"Notification"' || { echo "missing event: $OUT"; exit 1; }
echo "$OUT" | grep -q '"notificationType":"permission_prompt"' || { echo "missing notificationType: $OUT"; exit 1; }
if echo "$OUT" | grep -qE 'SECRET|tool_input|transcript'; then echo "LEAK: $OUT"; exit 1; fi
echo "emit.sh ok: $OUT"
