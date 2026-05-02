#!/usr/bin/env bash
#
# Backup all settings from a Vercel project so it can be restored later.
# Captures:
#   - Project metadata (framework, node version, root directory, build cmds)
#   - Domains
#   - Environment variable NAMES and TARGETS (NOT plaintext values, see below)
#   - Git integration config
#
# IMPORTANT — env var values are NOT plaintext.
# Verified empirically on 2026-05-02: the GET /env?decrypt=true endpoint
# returns ciphertext blobs (typically 800-4500 chars) regardless of the
# `decrypt=true` parameter, with the API tokens this script can use.
# Vercel reserves true plaintext access for the `vercel env pull` CLI
# flow, which uses a different auth path.
#
# What the JSON IS useful for:
#   - Inventory of which secrets exist on which environment (production/
#     preview/development) — i.e. a "what to re-create" checklist
#   - Project settings (framework, node version, build commands)
#   - Domain configuration
# What it is NOT useful for:
#   - One-shot restore of secret values
#
# To capture plaintext values for true restore-ability, run from a
# regular Windows shell (NOT this WSL session — the npm-installed CLI
# hangs from WSL):
#   cd <project-dir-on-windows>
#   vercel env pull .env.production --environment=production
#   vercel env pull .env.preview --environment=preview
#   vercel env pull .env.development --environment=development
# Then store those .env.* files securely (e.g. a password manager).
#
# Usage:
#   1. Create a temporary token at https://vercel.com/account/tokens
#      Recommended scope: "Full account", expiry 1 day.
#   2. Run:
#        VERCEL_TOKEN=<paste-token> bash scripts/backup-vercel-project.sh \
#          <project-name-or-id> [team-id]
#   3. The backup is written to ./vercel-backups/<project>-<timestamp>.json
#   4. Delete the token at https://vercel.com/account/tokens
#
# Restoring later:
#   - Re-import the GitHub repo into a new Vercel project
#   - Re-add env vars from the .env.* files captured via `vercel env pull`
#     (paste each variable in the Vercel dashboard or via `vercel env add`)
#   - Re-add custom domains from the JSON and verify

set -euo pipefail

if [[ -z "${VERCEL_TOKEN:-}" ]]; then
  echo "Error: VERCEL_TOKEN env var is required." >&2
  echo "Create one at https://vercel.com/account/tokens and re-run as:" >&2
  echo "  VERCEL_TOKEN=<token> bash $0 <project> [team-id]" >&2
  exit 1
fi

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <project-name-or-id> [team-id]" >&2
  exit 1
fi

PROJECT="$1"
TEAM_ID="${2:-}"
API="https://api.vercel.com"
AUTH=(-H "Authorization: Bearer $VERCEL_TOKEN")
TS="$(date -u +%Y%m%d-%H%M%S)"
OUT_DIR="vercel-backups"
mkdir -p "$OUT_DIR"
OUT_FILE="$OUT_DIR/${PROJECT}-${TS}.json"

# Build query string for team scope (empty if not on a team)
TEAM_QS=""
[[ -n "$TEAM_ID" ]] && TEAM_QS="?teamId=$TEAM_ID"
TEAM_QS_AND=""
[[ -n "$TEAM_ID" ]] && TEAM_QS_AND="&teamId=$TEAM_ID"

echo "[backup] project=$PROJECT team=${TEAM_ID:-personal}"
echo "[backup] writing to $OUT_FILE"

# --- Project metadata
echo "[backup] fetching project metadata…"
PROJECT_JSON="$(curl -fsSL "${AUTH[@]}" \
  "$API/v9/projects/$PROJECT$TEAM_QS")"

# --- Domains
echo "[backup] fetching domains…"
DOMAINS_JSON="$(curl -fsSL "${AUTH[@]}" \
  "$API/v9/projects/$PROJECT/domains$TEAM_QS")"

# --- Env vars (decrypted values).
# `decrypt=true` returns the plaintext values — keep this file out of git.
echo "[backup] fetching env vars (decrypted)…"
ENV_JSON="$(curl -fsSL "${AUTH[@]}" \
  "$API/v9/projects/$PROJECT/env?decrypt=true$TEAM_QS_AND")"

# --- Combine into one file (Python — no jq dependency)
PROJECT_JSON="$PROJECT_JSON" \
DOMAINS_JSON="$DOMAINS_JSON" \
ENV_JSON="$ENV_JSON" \
TS="$TS" \
PROJECT_NAME="$PROJECT" \
TEAM_ID_VAL="$TEAM_ID" \
OUT_FILE="$OUT_FILE" \
python3 <<'PY'
import json, os, sys

bundle = {
    "backed_up_at": os.environ["TS"],
    "project_name": os.environ["PROJECT_NAME"],
    "team_id": os.environ["TEAM_ID_VAL"],
    "project": json.loads(os.environ["PROJECT_JSON"]),
    "domains": json.loads(os.environ["DOMAINS_JSON"]),
    "env": json.loads(os.environ["ENV_JSON"]),
}

with open(os.environ["OUT_FILE"], "w") as f:
    json.dump(bundle, f, indent=2, sort_keys=True)

env_count = len(bundle["env"].get("envs", [])) if isinstance(bundle["env"], dict) else 0
dom_count = len(bundle["domains"].get("domains", [])) if isinstance(bundle["domains"], dict) else 0
print(f"[backup] env var count: {env_count}", file=sys.stderr)
print(f"[backup] domains: {dom_count}", file=sys.stderr)
PY

# Hide from git in case someone runs this inside a repo by accident.
if [[ ! -f "$OUT_DIR/.gitignore" ]]; then
  printf '*\n!.gitignore\n' > "$OUT_DIR/.gitignore"
fi

echo "[backup] done -> $OUT_FILE"
echo
echo "Reminder: revoke the temporary token at"
echo "  https://vercel.com/account/tokens"
