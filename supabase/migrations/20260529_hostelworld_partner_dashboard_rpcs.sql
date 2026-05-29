-- Daily breakdown of Hostelworld clicks for the partner-facing admin
-- dashboard. Returns one row per day in the window (zero-filled — even
-- days with no clicks appear, so the chart line doesn't lie about
-- coverage gaps).
--
-- Used by /admin/partners/hostelworld/dashboard for the time-series chart
-- and the CSV export. Service-role only.
CREATE OR REPLACE FUNCTION public.hostelworld_stats_daily(
  since timestamptz,
  until timestamptz DEFAULT now()
)
RETURNS TABLE (
  day                date,
  clicks             bigint,
  unique_visitors    bigint,
  unique_trips       bigint,
  mobile_clicks      bigint,
  desktop_clicks     bigint,
  tablet_clicks      bigint
)
LANGUAGE sql
SECURITY INVOKER
STABLE
AS $$
  WITH days AS (
    SELECT generate_series(
      date_trunc('day', since),
      date_trunc('day', until),
      interval '1 day'
    )::date AS d
  ),
  by_day AS (
    SELECT
      date_trunc('day', created_at)::date AS d,
      COUNT(*)                                                AS clicks,
      COUNT(DISTINCT COALESCE(user_id::text, visitor_cookie)) AS unique_visitors,
      COUNT(DISTINCT trip_id)                                 AS unique_trips,
      COUNT(*) FILTER (WHERE device_class = 'mobile')         AS mobile_clicks,
      COUNT(*) FILTER (WHERE device_class = 'desktop')        AS desktop_clicks,
      COUNT(*) FILTER (WHERE device_class = 'tablet')         AS tablet_clicks
    FROM public.hostelworld_clicks
    WHERE created_at >= since AND created_at <= until
    GROUP BY 1
  )
  SELECT
    days.d,
    COALESCE(b.clicks, 0)          AS clicks,
    COALESCE(b.unique_visitors, 0) AS unique_visitors,
    COALESCE(b.unique_trips, 0)    AS unique_trips,
    COALESCE(b.mobile_clicks, 0)   AS mobile_clicks,
    COALESCE(b.desktop_clicks, 0)  AS desktop_clicks,
    COALESCE(b.tablet_clicks, 0)   AS tablet_clicks
  FROM days
  LEFT JOIN by_day b ON b.d = days.d
  ORDER BY days.d;
$$;

-- Top destinations clicked in the window. Useful for "your partnership
-- is driving travelers to these cities" narrative.
CREATE OR REPLACE FUNCTION public.hostelworld_top_destinations(
  since timestamptz,
  max_rows integer DEFAULT 10
)
RETURNS TABLE (
  destination     text,
  clicks          bigint,
  unique_visitors bigint
)
LANGUAGE sql
SECURITY INVOKER
STABLE
AS $$
  SELECT
    destination,
    COUNT(*)                                                AS clicks,
    COUNT(DISTINCT COALESCE(user_id::text, visitor_cookie)) AS unique_visitors
  FROM public.hostelworld_clicks
  WHERE created_at >= since
    AND destination IS NOT NULL
    AND destination <> ''
  GROUP BY destination
  ORDER BY clicks DESC
  LIMIT max_rows;
$$;

REVOKE ALL ON FUNCTION public.hostelworld_stats_daily(timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hostelworld_stats_daily(timestamptz, timestamptz) TO service_role;

REVOKE ALL ON FUNCTION public.hostelworld_top_destinations(timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hostelworld_top_destinations(timestamptz, integer) TO service_role;
