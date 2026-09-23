-- Stop signed-in users reading page_views. Applied to production on
-- 2026-09-23, before merge, because it was an active exposure (found by the
-- adversarial review of the security branch, after page_views_human had
-- been closed in 20260924110000).
--
-- "Allow authenticated reads" was FOR SELECT TO authenticated USING (true),
-- on top of full table grants, so anyone who signed up for a free account
-- could GET /rest/v1/page_views and read every row: user_id, city,
-- latitude, longitude, user agent and session of every visitor, and every
-- path, which includes 171 /shared/<token> paths (64 of them for trips that
-- are not public, 34 private anonymous shares) and /invite/<token> paths,
-- one of them a live invite to a private trip.
--
-- Nothing reads page_views with a user or anon key: the middleware inserts
-- with the anon key and Prefer: return=minimal (no read-back), the beacon
-- route and crons use the service role, and every function that reads it
-- is a postgres-owned SECURITY DEFINER function. So the read policy goes
-- and anon/authenticated keep only INSERT; page_views_anon_insert stays.
--
-- Share and invite tokens that were readable stay valid; rotating them would
-- break every link already sent, so that is left as a decision.

drop policy if exists "Allow authenticated reads" on public.page_views;

revoke all on public.page_views from public, anon, authenticated;
grant insert on public.page_views to anon, authenticated;
