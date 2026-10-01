-- Close trip_today_actions to the public API. Applied to production on
-- 2026-10-01, before merge, because it was an active exposure of the same
-- kind as anonymous_activity_votes (20260924111000).
--
-- The policy "Anyone can read today actions" was USING (true) for every role,
-- and anon and authenticated held the default table grants. Each row carries
-- actor_cookie_id, the value of the guest's mt_anon_voter cookie. With the
-- public anon key anyone could read it, set the cookie and act as that guest:
-- change their name or email, undo their expenses, leave the trip for them.
-- The rows also named guests on every trip. 2 rows on 2 trips (1 cookie) when
-- closed.
--
-- The browser only used the table as a "something changed" signal for live
-- updates; the rows come from /api/shared/[token]/today-actions (service role,
-- no cookie ids). The today-action route now announces each change on the
-- trip's broadcast channel instead, so the table leaves the realtime
-- publication too.
--
-- The one cookie id that was readable stays valid: rotating it would sign that
-- guest out of the trip, so that is left as a decision rather than done here.

drop policy if exists "Anyone can read today actions" on public.trip_today_actions;

revoke all on public.trip_today_actions from public, anon, authenticated;

do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'trip_today_actions'
  ) then
    alter publication supabase_realtime drop table public.trip_today_actions;
  end if;
end $$;
