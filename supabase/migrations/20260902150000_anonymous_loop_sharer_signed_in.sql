-- get_anonymous_loop: add sharer_signed_in.
--
-- 0 of 56 signed-out shares were claimed in 30 days (2026-09-02), and the data
-- could not say why: nothing tied a shared trip to the browser session that
-- minted it, so "the sharer never signed in again" and "the claim is broken"
-- looked identical. /api/trips/anonymous now logs share_link_created with the
-- sharer's mt_session_id, and this column counts the trips whose sharer
-- session later carried a signed-in wizard row. claimed / sharer_signed_in is
-- the claim mechanism's health; sharer_signed_in / anon_created is the
-- product's.
--
-- Return type changes, so DROP + CREATE (CREATE OR REPLACE cannot change OUT
-- columns) and the grants are re-applied: service_role only, PUBLIC revoked.

DROP FUNCTION IF EXISTS public.get_anonymous_loop(timestamptz, timestamptz);

CREATE FUNCTION public.get_anonymous_loop(p_from timestamptz, p_to timestamptz)
 RETURNS TABLE(
   anon_created     bigint,
   anon_visited     bigint,
   share_visits     bigint,
   plan_own_clicks  bigint,
   claimed          bigint,
   claimed_any      bigint,
   unclaimed_live   bigint,
   expired          bigint,
   sharer_signed_in bigint
 )
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with a as (
    select tr.id,
           tr.user_id,
           tr.claim_expires_at,
           (tr.trip_meta->>'claimed_at')::timestamptz as claimed_at
      from public.trips tr
     where tr.deleted_at is null
       and tr.created_at >= p_from
       and tr.created_at <  p_to
       and (tr.claim_token is not null or tr.trip_meta ? 'claimed_at')
  ),
  v as (
    select fe.trip_id,
           count(*) filter (where fe.event_type = 'share_link_visited') as visits,
           count(*) filter (where fe.event_type = 'plan_own_clicked')   as plan_own
      from public.funnel_events fe
     where fe.event_type in ('share_link_visited', 'plan_own_clicked')
       and fe.trip_id in (select id from a)
     group by fe.trip_id
  ),
  s as (
    -- the minting session (share_link_created carries it) later held a signed-in wizard row
    select distinct c.trip_id
      from public.funnel_events c
     where c.event_type = 'share_link_created'
       and c.session_id is not null
       and c.trip_id in (select id from a)
       and exists (select 1
                     from public.wizard_step_events w
                    where w.session_id = c.session_id
                      and w.user_id is not null
                      and w.created_at > c.created_at)
  )
  select count(*)::bigint                                                                 as anon_created,
         count(*) filter (where coalesce(v.visits, 0) > 0)::bigint                        as anon_visited,
         coalesce(sum(v.visits), 0)::bigint                                               as share_visits,
         coalesce(sum(v.plan_own), 0)::bigint                                             as plan_own_clicks,
         count(*) filter (where a.claimed_at is not null)::bigint                         as claimed,
         (select count(*)
            from public.trips x
           where x.deleted_at is null
             and x.trip_meta ? 'claimed_at'
             and (x.trip_meta->>'claimed_at')::timestamptz >= p_from
             and (x.trip_meta->>'claimed_at')::timestamptz <  p_to)::bigint               as claimed_any,
         count(*) filter (where a.user_id is null
                            and (a.claim_expires_at is null or a.claim_expires_at > now()))::bigint as unclaimed_live,
         count(*) filter (where a.user_id is null
                            and a.claim_expires_at is not null
                            and a.claim_expires_at <= now())::bigint                      as expired,
         count(*) filter (where s.trip_id is not null)::bigint                            as sharer_signed_in
    from a
    left join v on v.trip_id = a.id
    left join s on s.trip_id = a.id;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_anonymous_loop(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_anonymous_loop(timestamptz, timestamptz) TO service_role;
