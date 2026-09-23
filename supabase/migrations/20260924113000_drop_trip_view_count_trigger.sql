-- Drop the view-count trigger on trip_views. Apply at merge time: it is safe
-- with both the old and the new code, and it must be gone BEFORE the new
-- app/api/trips/[id]/view is live.
--
-- trigger_update_trip_view_count (AFTER INSERT, in no migration: it lived
-- only in the database and supabase/rls-baseline.json) ran
-- update_trip_view_count(), which is SECURITY INVOKER:
--   UPDATE trips SET view_count = (SELECT COUNT(*) FROM trip_views
--                                  WHERE trip_id = NEW.trip_id) ...
-- as whoever inserted the view. Under the old anon/authenticated inserts
-- that UPDATE was a no-op for everyone but the trip's owner or editor, so
-- view_count was stale on 122 of 125 viewed trips (40 against 494 real
-- views). The new route inserts through the service role, and there the
-- trigger would rewrite the trips row on every open by anyone, bumping
-- trips.updated_at each time (the sitemap lastmod, the twin-trip reminder
-- keeper and the baseline's edited-during-trip figure all read it).
--
-- view_count is now set where it is used: update_trip_trending_score
-- recounts it from trip_views, bots excluded (20260924120000). Nothing
-- renders view_count.

drop trigger if exists trigger_update_trip_view_count on public.trip_views;
drop function if exists public.update_trip_view_count();
