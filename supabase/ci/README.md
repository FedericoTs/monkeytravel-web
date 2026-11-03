# CI database

The signed-in browser tests (`.github/workflows/e2e-signed-in.yml`) run against
a local Supabase stack, never production. `start.sh` builds it:

1. starts the stack from a copy of `supabase/config.toml`, with no migrations,
   Postgres 17 and the `send_email` auth hook off, so mail goes to the stack's
   Mailpit;
2. loads `schema.sql.enc`, a snapshot of production's schema decrypted with the
   `CI_SCHEMA_KEY` secret;
3. applies the files in `supabase/migrations` newer than `schema.last-migration`,
   the newest one the snapshot already holds, so a PR's own migration runs too;
4. writes `.env.local` with the stack's URL and keys.

The workflow then creates the test accounts and trip (`scripts/e2e-fixtures.mts`)
and adds the rows `seed.sql` holds: data production has that the tests read.

The snapshot is there because no migration creates the base tables (`trips`,
`users`, ...): replaying `supabase/migrations` on an empty database fails. It is
encrypted because the repository is public. Admin email addresses in policies
are replaced with a placeholder when it is written.

## Refreshing the snapshot

Refresh it when a test needs schema that came from outside `supabase/migrations`,
or when many migrations have piled up past `schema.last-migration`.

1. Write the schema from production:
   `psql "$PRODUCTION_DB_URL" -X -At -f supabase/ci/snapshot.sql > schema.sql`
2. Check `schema.sql` holds no keys, tokens or email addresses.
3. Encrypt it with a new key:

   ```bash
   openssl rand -base64 32 | tr -d '\r\n' > key
   CI_SCHEMA_KEY=$(cat key) openssl enc -aes-256-cbc -md sha256 -pbkdf2 -iter 200000 -salt \
     -pass env:CI_SCHEMA_KEY -in schema.sql -out supabase/ci/schema.sql.enc
   ```

4. Store the key for Actions and for Dependabot's pull requests, then delete
   `key` and `schema.sql`:

   ```bash
   gh secret set CI_SCHEMA_KEY < key
   gh secret set CI_SCHEMA_KEY --app dependabot < key
   ```

5. Write the newest file name in `supabase/migrations` to `schema.last-migration`
   (every migration up to it must be applied in production).

The key changes with the snapshot, so open pull requests need master merged in
after a refresh.
