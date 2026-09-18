-- The wizard funnel reads only human sessions (2026-09-18).
--
-- WHAT HAPPENED
-- page_views_human has excluded labelled automation since 2026-09-05, but
-- every read of wizard_step_events was still raw. A fleet that executes the
-- page's JavaScript fires wizard events like anyone else: on 2026-09-17,
-- 371 of the 457 sessions that reached step 1 were the Singapore fleet, and
-- the clean number was 86. So get_ux10x_rates (step 1 → 2), the
-- vw_ux10x_daily_baseline series and get_wizard_planning_stats (the "trips
-- planned in the last 30 days" figure on the wizard masthead) all moved 5x
-- with the fleet, and scripts/flag-review.mts read the same rows.
--
-- WHAT THIS DOES
--   wizard_step_events_human: the table minus any row whose (session, UTC day)
--   is labelled in page_view_session_labels. Same mechanism as
--   page_views_human, so every rule the labeller learns applies to the funnel
--   the same night. Service-role read only; the wizard page reaches the
--   planning figure through the SECURITY DEFINER RPC as before.
--
--   The three readers above now use the view. get_activation_funnel and
--   get_anonymous_loop are keyed on signed-in users and a signed-in session is
--   never labelled, so they are unchanged. label_automation_sessions keeps
--   reading the raw table: the family_conversionless rule needs to know which
--   sessions fired wizard events BEFORE they are labelled.
--
-- LABEL, NEVER BLOCK. Nothing here refuses a request.

create or replace view public.wizard_step_events_human as
  select w.*
  from public.wizard_step_events w
  where not exists (
    select 1 from public.page_view_session_labels l
    where l.session_id = w.session_id
      and l.day = w.created_at::date
      and l.is_automation
  );

comment on view public.wizard_step_events_human is
  'wizard_step_events minus rows whose (session_id, UTC day) is labelled in page_view_session_labels. The funnel reads this; only label_automation_sessions reads the raw table. Columns are frozen at creation: recreate the view when the table gains a column the funnel needs.';

revoke all on public.wizard_step_events_human from public, anon, authenticated;
grant select on public.wizard_step_events_human to service_role;

create or replace function public.get_ux10x_rates(lo timestamp with time zone, hi timestamp with time zone)
returns table(step1_to_2_pct numeric, weekly_active_crews integer)
language sql
stable
set search_path to 'public'
as $function$
  WITH w AS (
    SELECT session_id,
           bool_or(step = 'step_1_destination_dates') AS s1,
           bool_or(step = 'step_2_vibes')             AS s2
    FROM public.wizard_step_events_human
    WHERE (front_door IS NULL OR front_door = 'wizard')
      AND created_at >= lo AND created_at < hi
      AND session_id IS NOT NULL
    GROUP BY session_id
  ),
  rate AS (
    SELECT round(
             100.0 * count(*) FILTER (WHERE s1 AND s2)
             / nullif(count(*) FILTER (WHERE s1), 0), 1) AS pct
    FROM w
  ),
  crews AS (
    SELECT count(DISTINCT trip_id) AS n
    FROM (
      SELECT trip_id FROM public.anonymous_activity_votes
        WHERE created_at >= lo AND created_at < hi AND trip_id IS NOT NULL
      UNION
      SELECT trip_id FROM public.funnel_events
        WHERE event_type = 'vote_cast'
          AND created_at >= lo AND created_at < hi AND trip_id IS NOT NULL
      UNION
      SELECT trip_id FROM public.trip_collaborators
        WHERE joined_at >= lo AND joined_at < hi AND trip_id IS NOT NULL
    ) x
  )
  SELECT
    COALESCE((SELECT pct FROM rate), 0)::numeric AS step1_to_2_pct,
    COALESCE((SELECT n FROM crews), 0)::integer  AS weekly_active_crews;
$function$;

create or replace function public.get_wizard_planning_stats()
returns integer
language sql
stable
security definer
set search_path to 'public'
as $function$
  SELECT count(DISTINCT session_id)::int
  FROM public.wizard_step_events_human
  WHERE session_id IS NOT NULL
    AND entered_at > now() - interval '30 days';
$function$;

create or replace view public.vw_ux10x_daily_baseline as
 WITH days AS (
         SELECT generate_series(date_trunc('day'::text, now() - '90 days'::interval), date_trunc('day'::text, now()), '1 day'::interval)::date AS day
        ), step1 AS (
         SELECT w.created_at::date AS day,
            count(DISTINCT w.session_id) AS n
           FROM public.wizard_step_events_human w
          WHERE w.step = 'step_1_destination_dates'::text AND w.user_id IS NULL AND w.session_id IS NOT NULL
          GROUP BY (w.created_at::date)
        ), saves AS (
         SELECT w.created_at::date AS day,
            count(*) AS n
           FROM public.wizard_step_events_human w
          WHERE w.step = 'saved'::text
          GROUP BY (w.created_at::date)
        ), tcreated AS (
         SELECT trips.created_at::date AS day,
            count(*) AS n
           FROM public.trips
          WHERE COALESCE(trips.is_template, false) = false AND trips.deleted_at IS NULL
          GROUP BY (trips.created_at::date)
        ), tshared AS (
         SELECT trips.shared_at::date AS day,
            count(*) AS n
           FROM public.trips
          WHERE trips.shared_at IS NOT NULL
          GROUP BY (trips.shared_at::date)
        ), aiconv AS (
         SELECT ai_conversations.created_at::date AS day,
            count(*) AS n
           FROM public.ai_conversations
          GROUP BY (ai_conversations.created_at::date)
        )
 SELECT d.day,
    COALESCE(s1.n, 0::bigint) AS anon_step1_sessions,
    COALESCE(sv.n, 0::bigint) AS saves,
    COALESCE(tc.n, 0::bigint) AS trips_created,
    COALESCE(ts.n, 0::bigint) AS trips_shared,
    COALESCE(ai.n, 0::bigint) AS ai_conversations
   FROM days d
     LEFT JOIN step1 s1 ON s1.day = d.day
     LEFT JOIN saves sv ON sv.day = d.day
     LEFT JOIN tcreated tc ON tc.day = d.day
     LEFT JOIN tshared ts ON ts.day = d.day
     LEFT JOIN aiconv ai ON ai.day = d.day
  ORDER BY d.day DESC;
