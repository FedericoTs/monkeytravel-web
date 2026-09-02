-- Activation visibility that does not depend on the visitor's cookie choice.
--
-- WHY
-- ---
-- Every activation number the team has looked at so far came from PostHog,
-- which only sees browsers that accepted analytics cookies and are not
-- running an ad blocker. Measured 2026-08-25: ~59% capture at best, and the
-- browsers that lose trips (stale flag caches, blocked /flags) are exactly the
-- ones PostHog cannot see. Meanwhile the database already holds every fact
-- the funnel needs -- auth.users (who signed up, with which provider, and
-- whether they confirmed), wizard_step_events (the consent-free funnel rows
-- the wizard writes server-side), trips (did a trip row ever exist) and
-- funnel_events (the share loop). Nothing joined them.
--
-- WHAT
-- ----
-- 1. get_activation_funnel(p_from, p_to): one row per signup provider for the
--    cohort that signed up in [p_from, p_to): signups, confirmed, reached the
--    wizard, generated, has a trip, generated-but-no-trip (the lost bucket
--    from the 2026-09-02 auto-save fix), and users who hit save_failed.
--    Events are counted from p_from onward with no upper bound: a cohort
--    funnel asks "did they ever", not "did they before the window closed".
--
--    "generated" is (result-type event) OR (has a trip). Measured before
--    writing this: in 30 days only 92 of 1,277 `result` rows carried a
--    user_id, because most generations happen signed-out and the user signs
--    up afterwards. A trip row is proof of a generation; the event alone
--    undercounts by half. The lost bucket stays strict -- event AND no trip --
--    so it can only shrink as the auto-save fix lands.
--
-- 2. get_anonymous_loop(p_from, p_to): the signed-out share loop for trips
--    minted in the window: created, opened by a human, "plan your own" taps,
--    claimed at signup, still claimable, expired. Anonymous trips are the rows
--    that carry a claim_token (live or expired) or a claimed_at stamp;
--    user_id IS NULL alone is not enough because templates are ownerless too.
--
-- 3. claim_anonymous_trip now stamps trip_meta.claimed_at. It used to null the
--    token and leave nothing behind, so a claimed trip was indistinguishable
--    from one the user created themselves and "0 of 44 anonymous trips ever
--    claimed" could not be verified from the data. The stamp makes the loop's
--    last step countable for the life of the row.
--
-- 4. funnel_events accepts 'trip_claimed' (the CHECK listed four values).
--    The claim route logs it with the user id so cohort joins are possible;
--    the trip_meta stamp is the durable copy.
--
-- Test and probe accounts (@test.local, mt-probe*, mt-e2e*) are excluded from
-- the cohort so a verification run never moves the dashboard.
--
-- ACCESS
-- ------
-- Both readers are SECURITY DEFINER (auth.users is not reachable otherwise)
-- and are revoked from PUBLIC, anon and authenticated explicitly: the earlier
-- geo RPC lockdown showed that revoking from anon alone is a no-op because
-- the grant lives on PUBLIC. service_role holds the only grant; the admin
-- route reaches them via createAdminClient().

-- 4. funnel_events: accept the new event ----------------------------------
ALTER TABLE public.funnel_events DROP CONSTRAINT IF EXISTS funnel_events_event_type_check;
ALTER TABLE public.funnel_events ADD CONSTRAINT funnel_events_event_type_check
  CHECK (event_type = ANY (ARRAY[
    'share_link_created'::text,
    'share_link_visited'::text,
    'vote_cast'::text,
    'plan_own_clicked'::text,
    'trip_claimed'::text
  ]));

-- 3. claim_anonymous_trip: leave a durable marker --------------------------
CREATE OR REPLACE FUNCTION public.claim_anonymous_trip(p_claim_token text, p_user_id uuid)
 RETURNS TABLE(claimed boolean, trip_id uuid, reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_trip_id uuid;
begin
  if p_claim_token is null or length(p_claim_token) < 20 then
    return query select false, null::uuid, 'invalid_token'::text;
    return;
  end if;

  if p_user_id is null then
    return query select false, null::uuid, 'not_authenticated'::text;
    return;
  end if;

  update public.trips t
     set user_id          = p_user_id,
         claim_token      = null,
         claim_expires_at = null,
         -- The only record that this trip started life signed-out. Read by
         -- get_anonymous_loop; never read by the app.
         trip_meta        = coalesce(t.trip_meta, '{}'::jsonb)
                            || jsonb_build_object('claimed_at', now(), 'claimed_from', 'anonymous_share'),
         updated_at       = now()
   where t.claim_token = p_claim_token
     and t.user_id is null
     and t.deleted_at is null
     and (t.claim_expires_at is null or t.claim_expires_at > now())
  returning t.id into v_trip_id;

  if v_trip_id is null then
    return query select false, null::uuid, 'unavailable'::text;
    return;
  end if;

  return query select true, v_trip_id, null::text;
end;
$function$;

-- 1. Signup cohort funnel by provider ---------------------------------------
CREATE OR REPLACE FUNCTION public.get_activation_funnel(p_from timestamptz, p_to timestamptz)
 RETURNS TABLE(
   provider          text,
   signups           bigint,
   confirmed         bigint,
   reached_wizard    bigint,
   generated         bigint,
   has_trip          bigint,
   generated_no_trip bigint,
   save_failed_users bigint
 )
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
  with u as (
    select au.id,
           au.email_confirmed_at,
           coalesce(au.raw_app_meta_data->>'provider', 'email') as provider
      from auth.users au
     where au.created_at >= p_from
       and au.created_at <  p_to
       and au.email not ilike '%@test.local'
       and au.email not ilike 'mt-probe%'
       and au.email not ilike 'mt-e2e%'
  ),
  w as (
    select e.user_id,
           bool_or(e.step in ('result', 'first_value', 'options_shown')) as generated,
           bool_or(e.step = 'save_failed')                               as save_failed
      from public.wizard_step_events e
     where e.created_at >= p_from
       and e.user_id in (select id from u)
     group by e.user_id
  ),
  t as (
    select tr.user_id, count(*) as trips
      from public.trips tr
     where tr.deleted_at is null
       and tr.user_id in (select id from u)
     group by tr.user_id
  )
  select u.provider,
         count(*)::bigint                                                                     as signups,
         count(*) filter (where u.email_confirmed_at is not null)::bigint                     as confirmed,
         count(*) filter (where w.user_id is not null or coalesce(t.trips, 0) > 0)::bigint    as reached_wizard,
         count(*) filter (where coalesce(w.generated, false) or coalesce(t.trips, 0) > 0)::bigint as generated,
         count(*) filter (where coalesce(t.trips, 0) > 0)::bigint                             as has_trip,
         count(*) filter (where coalesce(w.generated, false) and coalesce(t.trips, 0) = 0)::bigint as generated_no_trip,
         count(*) filter (where coalesce(w.save_failed, false))::bigint                       as save_failed_users
    from u
    left join w on w.user_id = u.id
    left join t on t.user_id = u.id
   group by u.provider
   order by signups desc, provider;
$function$;

-- 2. Signed-out share loop --------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_anonymous_loop(p_from timestamptz, p_to timestamptz)
 RETURNS TABLE(
   anon_created    bigint,
   anon_visited    bigint,
   share_visits    bigint,
   plan_own_clicks bigint,
   claimed         bigint,
   claimed_any     bigint,
   unclaimed_live  bigint,
   expired         bigint
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
                            and a.claim_expires_at <= now())::bigint                      as expired
    from a
    left join v on v.trip_id = a.id;
$function$;

-- ACCESS: service_role only. PUBLIC is where the default grant lives.
REVOKE EXECUTE ON FUNCTION public.get_activation_funnel(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_anonymous_loop(timestamptz, timestamptz)    FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_activation_funnel(timestamptz, timestamptz) TO service_role;
GRANT  EXECUTE ON FUNCTION public.get_anonymous_loop(timestamptz, timestamptz)    TO service_role;
