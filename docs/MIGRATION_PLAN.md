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

### 1. spatial_ref_sys RLS — 1 ERROR
The MCP can't `ALTER TABLE public.spatial_ref_sys ENABLE RLS` because the
table is owned by the postgres superuser and the MCP runs with a less-
privileged role. The Claude Code auto-mode classifier also flagged
modifying extension-owned objects as needing explicit authorization.

**Fix it from the Supabase SQL editor:**
```sql
ALTER TABLE public.spatial_ref_sys ENABLE ROW LEVEL SECURITY;
CREATE POLICY spatial_ref_sys_public_read
  ON public.spatial_ref_sys FOR SELECT TO PUBLIC USING (true);
```
Safe — preserves current "world-readable" behaviour (PostGIS needs it) and
only silences the advisor.

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
