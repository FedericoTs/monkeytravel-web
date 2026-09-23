-- Close trip_views to anon and authenticated. APPLY AFTER THE CODE IS LIVE:
-- app/api/trips/[id]/view now inserts through the service role. Applied
-- before that, every view insert fails with 42501, the route answers
-- recorded:false, and the North Star silently stops collecting. The same
-- happens if Vercel is rolled back to a build from before this change.
--
-- The insert policy trip_views_anon_insert checked only trip_id IS NOT NULL,
-- and anon held every column, so anyone with the public anon key could POST
-- rows for any trip with any viewer_id (any real user), source ('owner'
-- included), viewed_on, session_id and is_bot = false: forged "opened
-- during travel" for the North Star and, through view_count, the trending
-- score. The route now checks the trip, derives the source and is the only
-- writer. The public read policy went earlier (20260924112000).
--
-- What stays: the route keys an anonymous visit on the mt_session_id
-- cookie, which a script can mint per request, so anonymous view rows can
-- still be multiplied through it (60/min/IP). They can no longer claim a
-- viewer, an owner source, a day or a bot flag, and trending no longer
-- counts them (20260924120000 counts distinct signed-in viewers).
--
-- Rollback: grant insert on public.trip_views to anon, authenticated and
-- recreate trip_views_anon_insert.

drop policy if exists trip_views_anon_insert on public.trip_views;

revoke all on public.trip_views from public, anon, authenticated;
