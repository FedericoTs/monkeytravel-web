# Migration plan — Trawell (sevfbahwmlbdlnbhqwyi)

Updated: 2026-05-28 (Tier 1.2 + 1.3 added).
Author: Claude session that applied the May 2026 migration backlog.

This document is **the source of truth** for what's been applied to prod
and what's planned next. Keep it current when you push a migration so
parallel work (other projects, other Supabase accounts) can plan around
it.

---

## Applied 2026-05-28 — round 1 (backlog catch-up)

| Migration | Effect | Risk |
|---|---|---|
| `notifications_scaffold` | New table `public.notifications` + RLS + indexes + realtime publication | None — additive |
| `atomic_counters` | New RPCs: `increment_referral_clicks`, `increment_template_copy_count`, `consume_tester_code` | None — additive, replaces racy reads in app code |
| `email_log_and_invite_email` | New table `public.email_log` + 3 nullable columns on `trip_invites` (`recipient_email`, `recipient_locale`, `message`) | None — additive |
| `explore_ugc_feed` | 9 new columns on `trips` (incl. `like_count`, `save_count`, `fork_count`, `is_hidden`, `is_editors_pick`, `parent_trip_id`), 3 new tables (`trip_likes`, `trip_saves`, `trip_reports`), 5 new RPCs for atomic counters, updated `update_trip_trending_score` formula, new `trips_explore_public_read` RLS policy | None — additive. All new columns have safe defaults. |

## Applied 2026-05-28 — round 2 (Tier 1)

| Tier | Migration | Effect | Code commit |
|---|---|---|---|
| 1.2 | `cache_travel_style` | `destination_activity_cache.travel_style TEXT NOT NULL DEFAULT 'classic'`; UNIQUE rebuilt to include it. Re-enables AI cache for Backpacker Mode (was skipping → ~$0.02-0.05/gen wasted) | `ac60c35` |
| 1.3 | `hostelworld_clicks` | New service-role-only table for click attribution on the Backpacker → Hostelworld CTA. Powers the "we drove N searches to you" metric for the partnership pitch | `f2a6f84` |

State after: 125 applied migrations, 1 ERROR-level advisor (`spatial_ref_sys` — requires dashboard).

---

## What's NOT yet applied (you need to do these in Supabase dashboard)

### 1. spatial_ref_sys RLS — 1 ERROR (escalation required)

**This cannot be fixed from any user-facing SQL surface — verified
2026-05-28.** Multiple failed attempts confirm the constraint chain:

| What we tried | Error | Reason |
|---|---|---|
| `ALTER TABLE public.spatial_ref_sys ENABLE RLS` (MCP, postgres role) | `42501: must be owner of table` | Owner is `supabase_admin`; postgres role can't act as it |
| Same SQL via Supabase dashboard SQL Editor | Same `42501` error | Dashboard `postgres` role has identical privilege chain |
| `SET ROLE supabase_admin` | `42501: permission denied to set role` | Membership in `supabase_admin` is reserved for Supabase infra |
| `ALTER EXTENSION postgis SET SCHEMA extensions` | `0A000: extension "postgis" does not support SET SCHEMA` | PostGIS C extensions hardcode schema paths; SET SCHEMA is disabled in the extension's control file |

**Only two real paths forward (per https://supabase.com/docs/guides/database/extensions/postgis):**

**Path A — Supabase support ticket (recommended, zero downtime):**
> Project: sevfbahwmlbdlnbhqwyi (Trawell)
>
> Move `postgis` and `pg_trgm` extensions out of `public` to `extensions`. Database Linter flags `rls_disabled_in_public` on `public.spatial_ref_sys`. All standard fixes fail (extension is owned by `supabase_admin`; PostGIS doesn't support `SET SCHEMA`). Geometry data to preserve: `destinations.location`, `users.current_location` (both with GIST indexes).

**Path B — DIY destructive drop+recreate (NOT recommended without backup/restore plan):**
Per Supabase docs, the manual procedure is:
1. Drop all dependencies you created on PostGIS (the geography columns + GIST indexes)
2. Drop the PostGIS extension
3. `CREATE EXTENSION postgis SCHEMA extensions;`
4. Recreate the columns and indexes
5. Restore the geometry data from backup

This loses all geometry data unless you `pg_dump` the affected columns first. Real downtime risk — every `destinations` / `users` query that hits `location` will fail mid-migration.

**Until Supabase actions Path A or we plan a maintenance window for Path B:** the advisor stays at 1 ERROR. The risk is theoretical — `spatial_ref_sys` contains EPSG coordinate-system reference codes (e.g. "WGS84"), not user data. Worst case if Supabase enforces the new rule: PostgREST exposes the table to anon reads, which is what it does today anyway. No real security impact.

**DECISION LOCKED 2026-05-28** (per user):
> Wait for Supabase support to action Path A. If they don't (or set a hard enforcement deadline), fall back to Path B with a planned maintenance window. The on-call procedure for Path B is captured below so it's ready when needed.

### Path B runbook (only if Supabase support declines / runs late)

Pre-flight (read-only):
1. `pg_dump -Fc -t public.destinations -t public.users -t public.valid_detail -t public.geometry_dump` — backup every table that has a PostGIS column.
2. Confirm app code does NOT call `ST_*` functions unqualified during the window (or accept the brief query failure window).

The migration (transactional):
```sql
BEGIN;
-- 1. Capture data we need to restore
CREATE TEMP TABLE _bk_dest AS SELECT id, ST_AsEWKT(location) AS loc FROM public.destinations WHERE location IS NOT NULL;
CREATE TEMP TABLE _bk_user AS SELECT id, ST_AsEWKT(current_location) AS loc FROM public.users WHERE current_location IS NOT NULL;
-- 2. Drop columns + indexes that depend on PostGIS
DROP INDEX IF EXISTS public.idx_destinations_location;
DROP INDEX IF EXISTS public.idx_users_location;
ALTER TABLE public.destinations DROP COLUMN location;
ALTER TABLE public.users DROP COLUMN current_location;
-- 3. Drop the extension (cascades to spatial_ref_sys + all ST_* functions)
DROP EXTENSION postgis CASCADE;
DROP EXTENSION pg_trgm CASCADE;
-- 4. Recreate in the right schema
CREATE EXTENSION postgis SCHEMA extensions;
CREATE EXTENSION pg_trgm SCHEMA extensions;
-- 5. Update search_path so unqualified ST_* keeps working
ALTER ROLE authenticator SET search_path = "$user", public, extensions;
ALTER ROLE anon          SET search_path = "$user", public, extensions;
ALTER ROLE authenticated SET search_path = "$user", public, extensions;
ALTER ROLE service_role  SET search_path = "$user", public, extensions;
ALTER ROLE postgres      SET search_path = "$user", public, extensions;
-- 6. Re-create columns + indexes (now resolved via extensions schema)
ALTER TABLE public.destinations ADD COLUMN location geography(Point, 4326);
ALTER TABLE public.users        ADD COLUMN current_location geography(Point, 4326);
CREATE INDEX idx_destinations_location ON public.destinations USING gist (location);
CREATE INDEX idx_users_location        ON public.users        USING gist (current_location);
-- 7. Restore data
UPDATE public.destinations d SET location = ST_GeogFromEWKT(b.loc) FROM _bk_dest b WHERE d.id = b.id;
UPDATE public.users        u SET current_location = ST_GeogFromEWKT(b.loc) FROM _bk_user b WHERE u.id = b.id;
COMMIT;
```

Estimated window: ~5-15 min downtime for any /destinations or /profile query that reads location. Other surfaces unaffected. Rollback: `ROLLBACK` before COMMIT — DB unchanged.

### 2. Auth settings (dashboard → Authentication → Providers/Settings)
- **OTP expiry**: currently >1 hour. Recommended: 1 hour or less.
- **Leaked password protection**: disable → enable. Checks new passwords
  against HaveIBeenPwned.org.

Both are config toggles in the Supabase Auth section — not SQL.

---

## Known unresolved advisors (intentional / acceptable)

These are flagged but match a deliberate design decision. Don't bother
fixing unless the design changes.

| Advisor | Count | Why we accept it |
|---|---|---|
| `*_security_definer_function_executable` (anon + authenticated) | 33+33 | Atomic counter RPCs (`add_bananas`, `increment_trip_like_count`, etc.) MUST be SECURITY DEFINER to do the atomic UPDATE without callers needing elevated privileges. RLS on the parent row still gates result access. |
| `rls_policy_always_true` | 20 | Public-read tables for /explore, destination cache, page_views, etc. The `USING (true)` is deliberate — these surfaces are meant to be world-readable. |
| `extension_in_public` | 2 | PostGIS (`postgis`, `pg_trgm`) lives in `public` schema. Moving them out is a big surgery (every cross-schema reference would break). Defer until we hit a real reason. |
| `unused_index` | 99 | Indexes added defensively when tables were created. Most are still <30 days old and not yet exercised. Re-audit after 60 days of prod traffic before dropping. |
| `multiple_permissive_policies` | 52 | Cosmetic — Postgres handles overlapping `PERMISSIVE` policies correctly via OR. Each is intentional. |
| `public_bucket_allows_listing` (`avatars`) | 1 | Avatar URLs are public by design — anyone with the URL can render. Standard Supabase pattern. |
| `rls_enabled_no_policy` (`trip_reports`) | 1 | Service-role-only table; no client policy is correct. The advisor is INFO level. |

---

## Future migrations — plan for parallel work

These are the migrations the next few weeks of code will need. **Plan
around them now so you can sequence them with the other Supabase
project you're moving in parallel.**

### Tier 1 — STATUS

1. **`trips.travel_style` real column** — **PENDING** (~5 min)
   - **Why**: Backpacker Mode currently stores `travel_style` in
     `trip_meta` JSONB. Promoting it to a real column enables:
     - `/explore` filter chip "Backpacker" (blocked anyway until you
       set `EXPLORE_UGC_ENABLED=true` in Vercel)
     - Indexed query for "show all backpacker trips" without JSONB extract
     - Sub-policies that key on style
   - **Why pending**: /explore is still env-flag-gated. Doing this
     before flipping the flag delivers no user-visible value. Pair this
     with the env-flag flip.
   - **Migration shape**:
     ```sql
     ALTER TABLE public.trips
       ADD COLUMN IF NOT EXISTS travel_style TEXT
         CHECK (travel_style IN ('classic', 'backpacker'))
         DEFAULT 'classic';
     -- Backfill from JSONB
     UPDATE public.trips
       SET travel_style = trip_meta->>'travel_style'
       WHERE trip_meta->>'travel_style' IS NOT NULL;
     CREATE INDEX IF NOT EXISTS idx_trips_travel_style
       ON public.trips(travel_style) WHERE travel_style <> 'classic';
     ```

2. **`destination_activity_cache.travel_style` column** — ✅ **DONE**
   (migration `cache_travel_style` + commit `ac60c35`, applied
   2026-05-28). Backpacker generations now hit cache like classic ones,
   saving ~$0.02-0.05 per repeat backpacker destination.

3. **`hostelworld_clicks` event table** — ✅ **DONE**
   (migration `hostelworld_clicks` + commit `f2a6f84`, applied
   2026-05-28). Click tracking live. Pitch query for partnership:
   ```sql
   SELECT
     count(*) AS total_clicks,
     count(DISTINCT trip_id) AS trips_with_clicks,
     count(DISTINCT user_id) AS unique_users
   FROM public.hostelworld_clicks
   WHERE created_at > now() - interval '30 days';
   ```

### Tier 2 — possible in the next 4–6 weeks
*Bigger, may need discussion before applying.*

4. **`trips.country_code` real column** — for "filter by country" on
   /explore. Currently lives in `trip_meta.country_code` JSONB. Promote
   pattern identical to `travel_style`.

5. **`trips.author_user_id` denormalisation** — for partner-facing
   reports ("show me all trips authored by users from `@hostelworld.com`").
   Currently we'd have to join `trips` → `auth.users` for every row. A
   denormalised column + index makes the report fast.

6. **Move PostGIS extensions out of `public`** — silences the
   `extension_in_public` warnings. Multi-step: create a new schema,
   alter extension, search-path tweaks. Plan for a maintenance window.

### Tier 3 — speculative
*Capture these now so they don't surprise you later.*

7. **`trip_user_relations` table for the CRM loop** — if we add VIP /
   Partner / Press tagging on users (per the earlier conversation about
   Hostelworld being one of N), we'll need a relations table with
   (user_id, tag, notes, added_by).

8. **`affiliate_credentials` table** — once we land affiliate IDs for
   multiple partners (Hostelworld + Booking + Expedia), store the IDs
   in DB instead of env vars so we can rotate them per-region without
   a redeploy.

---

## How to apply a Tier-1 migration when you're ready

Either:
- **From this Claude session**: ask "apply migration X" and I'll use the
  Supabase MCP. Each Tier-1 migration takes seconds.
- **From the other project working in parallel**: I'll commit the
  migration to `supabase/migrations/` first (so the file is the source
  of truth), then apply it via MCP. Your parallel session can pull
  the same file when it syncs.

**Never let the migration file and the DB drift.** If you apply
something via the dashboard, mirror it into `supabase/migrations/` and
push the file. Future Claude sessions read the file list to know
what's "expected" in prod.

---

## Quick verification queries

Check anytime — these confirm the May 2026 migrations are healthy:

```sql
-- All 4 new surfaces exist + are accessible
SELECT
  (SELECT count(*) FROM public.notifications) AS notifications_rows,
  (SELECT count(*) FROM public.email_log) AS email_log_rows,
  (SELECT count(*) FROM public.trip_likes) AS trip_likes_rows,
  (SELECT count(*) FROM public.trip_saves) AS trip_saves_rows,
  (SELECT count(*) FROM public.trip_reports) AS trip_reports_rows;

-- All new RPCs exist
SELECT proname FROM pg_proc
WHERE proname IN (
  'increment_trip_like_count','decrement_trip_like_count',
  'increment_trip_save_count','decrement_trip_save_count',
  'increment_trip_fork_count','update_trip_trending_score',
  'increment_referral_clicks','increment_template_copy_count',
  'consume_tester_code'
)
ORDER BY proname;

-- Backpacker Mode storage works (this column should exist in trip_meta)
SELECT count(*) AS backpacker_trips
FROM public.trips
WHERE trip_meta->>'travel_style' = 'backpacker';
```
