#!/usr/bin/env bash
# Probe canary URLs and report cacheability signals (HTTP status, x-vercel-cache,
# age, cache-control, CSP presence) — the before/after gauge for the
# static-rendering migration. Usage: bash scripts/cache-probe.sh [base-url]
# Default base is production. The goal of the migration: x-vercel-cache flips
# from MISS (every hit runs a function) to HIT on the content routes below.
set -euo pipefail
BASE="${1:-https://monkeytravel.app}"
URLS=("/" "/it" "/blog" "/destinations/paris" "/explore" "/free-ai-trip-planner")
for path in "${URLS[@]}"; do
  echo "### ${BASE}${path}"
  curl -sI "${BASE}${path}" \
    | grep -iE '^(HTTP|x-vercel-cache|age|cache-control|content-security-policy):' \
    || true
  echo
done
