#!/usr/bin/env bash
# Capture the Next.js route table (○ static / ● SSG / ƒ dynamic) — the
# before/after gauge for the static-rendering migration (docs/static-migration/).
# Run from the repo root: bash scripts/route-table.sh
set -euo pipefail
npm run build 2>&1 | sed -n '/Route (app)/,/First Load JS/p'
