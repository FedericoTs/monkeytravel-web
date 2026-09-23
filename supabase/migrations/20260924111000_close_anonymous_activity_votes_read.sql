-- Close anonymous_activity_votes to the public API. Applied to production on
-- 2026-09-23, before merge, because it was an active exposure of the same
-- kind as page_views_human (20260924110000).
--
-- The policy "Anyone can read anonymous votes" was USING (true) for every
-- role, and anon and authenticated held the default table grants. Each vote
-- row carries the trip's share_token and the voter's voter_cookie_id. With
-- the public anon key anyone could:
--   - read the share token of every trip that has a vote, private anonymous
--     shares included, and open the whole trip at /shared/<token>;
--   - read voter_cookie_id, which is the value of the mt_anon_voter cookie
--     (also trip_participants.participant_cookie_id), and set it to act as
--     that voter or participant.
-- 57 rows on 9 trips when closed.
--
-- Every reader already uses the service role: app/api/shared/[token]/vote,
-- app/api/shared/[token]/votes, app/api/trips/[id]/crew-votes (after its
-- access check) and app/api/admin/growth. The table is not in the realtime
-- publication and no browser code reads it.
--
-- Cookie ids that were readable before this stay valid; rotating them would
-- sign every anonymous voter out of their votes, so that is left as a
-- decision rather than done here.

drop policy if exists "Anyone can read anonymous votes" on public.anonymous_activity_votes;

revoke all on public.anonymous_activity_votes from public, anon, authenticated;
