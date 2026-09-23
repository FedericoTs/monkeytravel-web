-- Lock down three SECURITY DEFINER functions any signed-in user could call.
--
-- Found 2026-09-23 by the Supabase security advisor (lint 0029) during a
-- read-only sweep, then confirmed against pg_proc: all three were
-- prosecdef = true with proacl {postgres=X, authenticated=X, service_role=X}.
-- 20260601_security_lockdown_anon_security_definer.sql revoked them from
-- PUBLIC and anon but never from `authenticated`, so any account holder could
-- run them with the owner's rights, which bypass row-level security.
--
-- 1. update_activity_website(trip_id, activity_name, website_url)
--    Loads ANY trip's itinerary by id and sets official_website on every
--    activity whose name ILIKE '%' || activity_name || '%' — an empty name
--    matches all of them — then writes the trip. No auth.uid() or ownership
--    check. official_website renders as a clickable link in ActivityCard,
--    EditableActivityCard, LiveActivityCard and ActivityDetailSheet, including
--    on shared trips that recipients open. So: stored link injection into any
--    trip, by anyone with an account. Trip UUIDs are in Google's index.
--    Nothing in app/, lib/, components/, scripts/ or supabase/functions calls
--    it. DROPPED, not revoked: a function nobody calls cannot be misgranted
--    again by a later migration.
--    Checked before dropping: of 591 trips carrying official_website links,
--    none shows the attack's signature (one URL across all of a trip's
--    activities), and the hosts are the expected official sites.
--
-- 2. increment_early_access_usage(p_user_id, p_field)
--    Validates the field name but not the caller, so anyone signed in could
--    burn another user's tester quota. No caller in the app today. Revoked
--    from authenticated; the service role keeps it.
--
-- 3. refresh_activity_index()
--    REFRESH MATERIALIZED VIEW CONCURRENTLY — expensive, and on a Nano
--    database a signed-in loop could have held it. The only caller is the
--    cron route, which uses the service-role client. 20260530 meant it to be
--    service-role only; this makes it so.

drop function if exists public.update_activity_website(uuid, text, text);

revoke execute on function public.increment_early_access_usage(uuid, text) from public, anon, authenticated;
grant execute on function public.increment_early_access_usage(uuid, text) to service_role;

revoke execute on function public.refresh_activity_index() from public, anon, authenticated;
grant execute on function public.refresh_activity_index() to service_role;
