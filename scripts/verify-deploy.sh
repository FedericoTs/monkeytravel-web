#!/usr/bin/env bash
#
# verify-deploy.sh — check Vercel CI/CD status for the latest pushed commit.
#
# Polls the GitHub statuses API (unauthenticated, works on public repos)
# until the Vercel deployment for the most recent commit reaches a terminal
# state (success | failure), or until the timeout is hit.
#
# Exit codes:
#   0 — deploy succeeded
#   1 — deploy failed
#   2 — timed out while still pending
#   3 — git/curl/jq missing or repo not pushed yet
#
# Usage:
#   ./scripts/verify-deploy.sh                # check HEAD on origin/master
#   ./scripts/verify-deploy.sh <sha>          # check a specific sha
#   ./scripts/verify-deploy.sh <sha> 300      # custom timeout (sec, default 360)
#
# Run this immediately after every `git push origin master`. Do not declare
# "deployed" without this returning 0. See CLAUDE.md → "CI/CD verification
# is mandatory after every push" for the why.

set -euo pipefail

REPO_OWNER="FedericoTs"
REPO_NAME="monkeytravel-web"
SHA="${1:-$(git rev-parse HEAD)}"
TIMEOUT_SEC="${2:-360}"
POLL_INTERVAL_SEC=20

if ! command -v curl >/dev/null 2>&1; then
  echo "verify-deploy: curl not found" >&2
  exit 3
fi

# python is shipped with most environments; we just use it for tiny JSON parsing
# rather than introducing a jq dependency.
if ! command -v python >/dev/null 2>&1 && ! command -v python3 >/dev/null 2>&1; then
  echo "verify-deploy: python (or python3) not found" >&2
  exit 3
fi
PY=$(command -v python || command -v python3)

API_URL="https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/commits/${SHA}/status"

echo "verify-deploy: watching CI for ${SHA:0:8} (timeout ${TIMEOUT_SEC}s)..."

started=$(date +%s)
last_state=""

while :; do
  body=$(curl -fsS -H "Accept: application/vnd.github+json" -A "monkeytravel-deploy-check" "$API_URL" || echo '')
  if [ -z "$body" ]; then
    echo "verify-deploy: GitHub API unreachable, retrying..."
    sleep "$POLL_INTERVAL_SEC"
    continue
  fi

  state=$("$PY" -c "import sys,json; print(json.loads(sys.stdin.read())['state'])" <<<"$body")
  detail=$("$PY" -c "import sys,json;d=json.loads(sys.stdin.read());s=d.get('statuses',[]);print(' | '.join(f\"{x.get('context','?')}: {x.get('state','?')} - {x.get('description','')}\" for x in s))" <<<"$body")

  if [ "$state" != "$last_state" ]; then
    echo "verify-deploy: state=${state}  ${detail}"
    last_state="$state"
  fi

  case "$state" in
    success)
      echo "verify-deploy: PASS ✓ ${SHA:0:8} is live"
      exit 0
      ;;
    failure|error)
      echo "verify-deploy: FAIL ✗ ${SHA:0:8} deploy failed" >&2
      echo "                 ${detail}" >&2
      exit 1
      ;;
    pending|*)
      now=$(date +%s)
      elapsed=$((now - started))
      if [ "$elapsed" -ge "$TIMEOUT_SEC" ]; then
        echo "verify-deploy: TIMEOUT after ${TIMEOUT_SEC}s, still pending" >&2
        exit 2
      fi
      sleep "$POLL_INTERVAL_SEC"
      ;;
  esac
done
