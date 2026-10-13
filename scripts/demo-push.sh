#!/usr/bin/env bash
# T-705 demo kit: scripted commits on an hk-* branch of the DEMO repository (docs/archive/DEMO.md §4).
# Run it in a local clone of the demo project's GitHub repo, never in the Hakit repo itself.
#
#   scripts/demo-push.sh <path-to-demo-repo-clone> <HK-number> [slug] [commits]
#   scripts/demo-push.sh ~/demo/orbit 4 auth 2
#
# Creates or reuses branch hk-<n>-<slug>, appends small changes to DEMO_LOG.md, commits with an
# "HK-<n>" reference (a confirmed link, docs/AI.md §C.5), and pushes. DRY_RUN=1 skips the push.
set -euo pipefail

repo="${1:?path to the demo repo clone}"
number="${2:?HK task number, e.g. 4}"
slug="${3:-demo}"
commits="${4:-1}"
branch="hk-${number}-${slug}"

[[ "$number" =~ ^[0-9]+$ ]] || { echo "HK number must be numeric" >&2; exit 2; }
[[ "$commits" =~ ^[0-9]+$ && "$commits" -ge 1 ]] || { echo "commits must be >= 1" >&2; exit 2; }
git -C "$repo" rev-parse --is-inside-work-tree >/dev/null
if git -C "$repo" ls-files --error-unmatch packages/engine/src/index.ts >/dev/null 2>&1; then
  echo "refusing: $repo looks like the Hakit repo; point this at the demo project's clone" >&2
  exit 2
fi
if [[ -n "$(git -C "$repo" status --porcelain)" ]]; then
  echo "refusing: $repo has uncommitted changes" >&2
  exit 2
fi

if git -C "$repo" show-ref --verify --quiet "refs/heads/$branch"; then
  git -C "$repo" checkout --quiet "$branch"
else
  git -C "$repo" checkout --quiet -b "$branch"
fi

for i in $(seq 1 "$commits"); do
  printf -- '- %s HK-%s step %s\n' "$(date -u +%H:%M:%SZ)" "$number" "$i" >>"$repo/DEMO_LOG.md"
  git -C "$repo" add DEMO_LOG.md
  git -C "$repo" commit --quiet -m "HK-${number}: ${slug} progress (${i}/${commits})"
done

if [[ "${DRY_RUN:-0}" == "1" ]]; then
  echo "DRY_RUN: committed ${commits} on ${branch}; not pushed"
else
  git -C "$repo" push --quiet -u origin "$branch"
  echo "pushed ${commits} commit(s) to ${branch}; watch Mission Control for the confirmed link"
fi
