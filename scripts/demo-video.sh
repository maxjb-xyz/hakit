#!/usr/bin/env bash
# One-stop helper for recording the demo video (docs/VIDEO.md). Wraps the T-705 demo kit.
#
#   scripts/demo-video.sh setup <github-login>   # seed the demo workspace on the fork
#   scripts/demo-video.sh swap                    # shot 5: swap the React lead for the ML engineer
#   scripts/demo-video.sh push                    # shot 7: push 2 HK-4 commits to the demo repo
#   scripts/demo-video.sh stall                   # shot 8: make HK-4 stall on the critical path
#   scripts/demo-video.sh reset                   # start over (then run setup again)
#
# Needs DEMO_DATABASE_URL (the Tiger fork the deployment uses) and, for push, DEMO_REPO (a local
# clone of the throwaway demo repo). Put both in scripts/.demo-video.env to avoid retyping.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
[[ -f "$root/scripts/.demo-video.env" ]] && source "$root/scripts/.demo-video.env"
: "${DEMO_DATABASE_URL:?Set DEMO_DATABASE_URL to the demo Tiger fork (see docs/VIDEO.md)}"
export DEMO_DATABASE_URL DEMO_FORK_CONFIRM=yes

demo() { (cd "$root" && pnpm --silent --filter @hakit/web demo "$@"); }

case "${1:-}" in
  setup)
    login="${2:?usage: setup <your-github-login>}"
    demo seed --owner "$login"
    echo
    echo "Seeded. Open the app, sign in as $login, and start recording (docs/VIDEO.md)."
    ;;
  swap) demo swap ;;
  stall) demo stall 4 && echo "HK-4 stalled. The recommendation appears within ~2 min (edit any task to speed it up)." ;;
  push)
    : "${DEMO_REPO:?Set DEMO_REPO to a local clone of the demo repo}"
    "$root/scripts/demo-push.sh" "$DEMO_REPO" 4 auth 2
    ;;
  reset) demo reset ;;
  *) sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
