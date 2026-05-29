#!/usr/bin/env bash
#
# verify-deploy-smoke.sh — post-deploy smoke probe for critical routes.
#
# Why this exists: cycle-5's SSR-500 incident shipped because the deploy
# pipeline reported "success" while every React-rendered route was throwing
# at request time (useContext returned undefined in SessionTracker because
# AuthProvider lived under app/[locale]/layout.tsx, not app/layout.tsx).
# `next build` + `tsc --noEmit` both passed. Only a live HTTP probe of the
# rendered routes catches that class of regression.
#
# Run this after every deploy that verify-deploy.sh reports green.
#
# Usage:
#   bash scripts/verify-deploy-smoke.sh                          # prod
#   bash scripts/verify-deploy-smoke.sh https://monkeytravel.app
#   bash scripts/verify-deploy-smoke.sh http://localhost:3000
#
# Exit codes:
#   0 — every route returned 2xx or 3xx (redirects are OK; locale roots redirect)
#   1 — one or more routes returned 5xx, 4xx, or timed out
#   3 — curl missing

set -uo pipefail

BASE_URL="${1:-https://monkeytravel.app}"
BASE_URL="${BASE_URL%/}"  # strip trailing slash
TIMEOUT_SEC=10

if ! command -v curl >/dev/null 2>&1; then
  echo "verify-deploy-smoke: curl not found" >&2
  exit 3
fi

# Routes to probe. Order matters only for readability of the output table.
ROUTES=(
  "/"
  "/blog"
  "/it"
  "/es"
  "/it/explore"
  "/it/backpacker"
  "/api/health"
  "/robots.txt"
  "/sitemap.xml"
)

printf "verify-deploy-smoke: probing %s (timeout %ds)\n" "$BASE_URL" "$TIMEOUT_SEC"
printf "\n%-22s %-7s %-10s\n" "ROUTE" "STATUS" "TTFB(s)"
printf "%-22s %-7s %-10s\n" "----------------------" "------" "----------"

FAILED=""
ALL_PASS=1

for route in "${ROUTES[@]}"; do
  url="${BASE_URL}${route}"
  # %{http_code} = HTTP status, %{time_starttransfer} = TTFB in seconds
  # -o /dev/null discards body; we only care about status + timing
  # -L would follow redirects — we DON'T follow, because a 307 to /it on /
  #    is a legitimate green signal, and following could mask redirect loops.
  # -A spoofs a friendly UA so we don't get bot-walled by Vercel edge rules.
  result=$(curl -s -o /dev/null \
                -w "%{http_code} %{time_starttransfer}" \
                --max-time "$TIMEOUT_SEC" \
                -A "monkeytravel-deploy-smoke/1.0" \
                "$url" 2>/dev/null || echo "000 0")

  status=$(echo "$result" | awk '{print $1}')
  ttfb=$(echo "$result"   | awk '{print $2}')

  # 2xx and 3xx are pass. 000 = curl error (timeout, DNS, conn refused).
  case "$status" in
    2*|3*)
      mark="OK"
      ;;
    000)
      mark="TIMEOUT/CONN"
      ALL_PASS=0
      FAILED="${FAILED} ${route}(timeout)"
      ;;
    *)
      mark="FAIL"
      ALL_PASS=0
      FAILED="${FAILED} ${route}(${status})"
      ;;
  esac

  printf "%-22s %-7s %-10s %s\n" "$route" "$status" "$ttfb" "$mark"
done

echo ""
if [ "$ALL_PASS" -eq 1 ]; then
  echo "SMOKE PASS"
  exit 0
else
  # Trim leading space, print first failure for at-a-glance triage
  first_fail=$(echo "$FAILED" | awk '{print $1}')
  echo "SMOKE FAIL:${FAILED}"
  echo "First failing route: ${first_fail}"
  exit 1
fi
