#!/usr/bin/env bash
# Starts a local Supabase stack with production's schema and points the app at
# it, for the signed-in browser tests (.github/workflows/e2e-signed-in.yml).
# README.md in this folder explains the snapshot and how to refresh it.
#
# Needs CI_SCHEMA_KEY (the snapshot's key), the Supabase CLI, Docker and psql.
# Writes .env.local with the stack's URL and keys.
set -euo pipefail
export LC_ALL=C
cd "$(dirname "$0")/../.."

: "${CI_SCHEMA_KEY:?CI_SCHEMA_KEY is not set}"

# The stack runs from a copy of the config: without the migrations, which the
# snapshot stands in for, on production's Postgres version, with the auth hook
# that sends mail through production turned off (mail goes to the stack's
# Mailpit instead), and with room for the few emails the tests send.
stack=$(mktemp -d)
mkdir "$stack/supabase"
config="$stack/supabase/config.toml"
sed '/^\[auth\.hook\.send_email\]/,/^\[/ s/^enabled = true/enabled = false/' supabase/config.toml > "$config"
if sed -n '/^\[auth\.hook\.send_email\]/,/^\[/p' "$config" | grep -q '^enabled = true'; then
  echo "could not turn off the send_email auth hook" >&2
  exit 1
fi
grep -q '^\[db\]' "$config" || printf '\n[db]\nmajor_version = 17\n' >> "$config"
grep -q '^\[auth\.rate_limit\]' "$config" || printf '\n[auth.rate_limit]\nemail_sent = 100\n' >> "$config"

supabase start --workdir "$stack" -x imgproxy,studio,edge-runtime,logflare,vector,supavisor
eval "$(supabase status --workdir "$stack" -o env | grep -E '^[A-Z0-9_]+=')"
: "${API_URL:?}" "${DB_URL:?}" "${ANON_KEY:?}" "${SERVICE_ROLE_KEY:?}"

sql() { psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 "$@"; }

# psql's output would print the schema into a public log: on failure, only the
# error line is shown.
schema="$stack/schema.sql"
openssl enc -d -aes-256-cbc -md sha256 -pbkdf2 -iter 200000 -pass env:CI_SCHEMA_KEY \
  -in supabase/ci/schema.sql.enc -out "$schema"
if ! sql -f "$schema" > "$stack/load.log" 2>&1; then
  rm -f "$schema"
  grep 'ERROR:' "$stack/load.log" | sed -E 's/^psql:[^:]*:([0-9]+): /schema.sql line \1: /' >&2
  exit 1
fi
rm -f "$schema" "$stack/load.log"

through=$(cat supabase/ci/schema.last-migration)
for migration in supabase/migrations/*.sql; do
  name=$(basename "$migration")
  [[ "$name" > "$through" ]] || continue
  echo "Applying $name"
  sql -f "$migration"
done

# PostgREST read the schema when the stack started, before the snapshot.
sql -c "NOTIFY pgrst, 'reload schema'"
ready=""
for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null "$API_URL/rest/v1/trips?select=id&limit=1" \
    -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" 2>/dev/null; then
    ready=1
    break
  fi
  sleep 1
done
[[ -n "$ready" ]] || { echo "PostgREST did not pick up the schema" >&2; exit 1; }

cat > .env.local <<EOF
NEXT_PUBLIC_SUPABASE_URL=$API_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
EOF
# Later workflow steps seed rows with psql.
if [[ -n "${GITHUB_ENV:-}" ]]; then
  echo "SUPABASE_DB_URL=$DB_URL" >> "$GITHUB_ENV"
fi
echo "Local Supabase is up at $API_URL with production's schema."
