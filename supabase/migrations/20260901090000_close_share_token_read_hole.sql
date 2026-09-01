-- Close the blanket share_token read on public.trips.
--
-- WHAT WAS WRONG
-- --------------
-- trips_select_consolidated carried a bare
--
--     OR (share_token IS NOT NULL)
--
-- with no comparison against a caller-supplied token. It made EVERY row that
-- merely HAS a share_token readable by anyone holding the anon key -- which
-- ships in the browser bundle and is public by design.
--
-- Measured 2026-09-01 as role anon, before this migration:
--     118  trips readable in total
--      42  of them visibility = 'private'
--      39  rows exposing a live claim_token
--      51  distinct real users affected
-- SELECT * returned every column: full itinerary, notes, description, budget,
-- emergency_contacts, share_token and claim_token.
--
-- claim_token is the worse half. app/api/trips/anonymous/route.ts states the
-- model in its own words -- "claim_token confers ownership exactly once" --
-- and /api/trips/claim needs only (a) any authenticated session and (b) the
-- token string before transferring user_id permanently. Publishing the token
-- to anon means any account could take an anonymous planner's trip.
--
-- WHY IT WAS HARMLESS AND THEN WAS NOT
-- ------------------------------------
-- The clause is documented as known behaviour in
-- 20260531_day11_perf_consolidate_permissive_policies.sql:187; that migration
-- was a performance consolidation and deliberately preserved semantics. It was
-- a small exposure then. The anonymous-share loop (2026-08-18) began minting a
-- share_token for every signed-out planner, and the leak grew from 1 trip in
-- March to 82 in August. Nobody re-checked the old clause against the new
-- feature.
--
-- WHY REMOVING IT IS SAFE
-- -----------------------
-- The narrower clause below it already covers genuinely public trips:
--     visibility = 'public' AND share_token IS NOT NULL AND is_hidden = false
-- That is what the Explore feed (app/api/explore/trips/route.ts) filters on, so
-- Explore is unaffected.
--
-- Anonymous shared trips are deliberately visibility = 'private'; their
-- readability comes from HOLDING the token. Every reader that needs them
-- already goes through service-role and matches the exact token:
--   app/api/shared/[token]/vote/route.ts     createAdminClient
--   app/api/shared/[token]/votes/route.ts    createAdminClient
--   app/api/trips/duplicate/route.ts         createAdminClient
--   app/api/calendar/trip/[id]/route.ts      createAdminClient
--   app/[locale]/shared/[token]/page.tsx     switched in the same PR as this
--                                            migration, and deployed BEFORE it
--
-- Note the ordering requirement: the page change must be live first, otherwise
-- shared links to private trips 404 in the window between the two.
--
-- MEASURED EFFECT (probed as role anon inside a rolled-back transaction)
--     trips visible to anon      118 -> 50   (the 50 are visibility='public')
--     private trips visible       42 -> 0
--     live claim_tokens visible   39 -> 0
--
-- Everything else in the policy is preserved byte-for-byte, including the
-- leading `deleted_at IS NULL`, which is what keeps soft-deleted trips
-- unreachable (see the trip-delete incident: 61 files rely on that).

alter policy trips_select_consolidated on public.trips
using (
  (deleted_at is null)
  and (
    (user_id = (select auth.uid()))
    or ((is_template = true) and (visibility = 'public'::text))
    or (exists (
          select 1
          from trip_collaborators
          where trip_collaborators.trip_id = trips.id
            and trip_collaborators.user_id = (select auth.uid())
        ))
    or ((visibility = 'public'::text) and (share_token is not null) and (is_hidden = false))
  )
);
