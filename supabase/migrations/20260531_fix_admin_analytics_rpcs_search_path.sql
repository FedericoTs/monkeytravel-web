-- Day-4 bug fix: 5 admin Analytics RPCs were created with
-- `SET search_path TO ''` while their bodies reference unqualified
-- tables (page_views, users, trips). With an empty search_path the
-- planner cannot resolve those names, so every call throws
-- 42P01 'relation does not exist' and the admin dashboard renders
-- DAU/WAU/MAU/Stickiness/Traffic-Sources/Time-to-trip as zero.
--
-- Fix: set search_path TO 'public' to match the working sibling
-- get_page_views_by_country. Function bodies are otherwise unchanged.
--
-- Verified post-apply on prod project sevfbahwmlbdlnbhqwyi:
--   get_engagement_metrics() -> dau=3, wau=15, mau=42 (was 0/0/0)
--   get_referrer_breakdown() -> 5 source rows, 118k internal hits
--   get_time_to_first_trip() -> median 0.1h, 25/34 users within 1h
--   get_page_views_daily_trend() -> 90d trend rows returned
--   get_page_views_by_section() -> 8 section rows returned
--
-- Caller: app/api/admin/stats/route.ts L260-264, 884
-- (Promise.allSettled with safe() fallback masked the failure from
-- Sentry — dashboard silently rendered all-zero since the day-2 RLS
-- sweep introduced the empty search_path.)

CREATE OR REPLACE FUNCTION public.get_engagement_metrics()
RETURNS TABLE(dau bigint, wau bigint, mau bigint, stickiness_pct numeric, users_with_trips bigint, total_users bigint)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH metrics AS (
    SELECT
      (SELECT COUNT(DISTINCT user_id) FROM page_views WHERE user_id IS NOT NULL AND created_at >= NOW() - INTERVAL '1 day') as dau,
      (SELECT COUNT(DISTINCT user_id) FROM page_views WHERE user_id IS NOT NULL AND created_at >= NOW() - INTERVAL '7 days') as wau,
      (SELECT COUNT(DISTINCT user_id) FROM page_views WHERE user_id IS NOT NULL AND created_at >= NOW() - INTERVAL '30 days') as mau,
      (SELECT COUNT(DISTINCT user_id) FROM trips) as users_with_trips,
      (SELECT COUNT(*) FROM users) as total_users
  )
  SELECT
    m.dau,
    m.wau,
    m.mau,
    CASE WHEN m.mau > 0 THEN ROUND((m.dau::numeric / m.mau::numeric) * 100, 1) ELSE 0 END as stickiness_pct,
    m.users_with_trips,
    m.total_users
  FROM metrics m;
$function$;

CREATE OR REPLACE FUNCTION public.get_referrer_breakdown()
RETURNS TABLE(source text, count bigint)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT
    CASE
      WHEN referrer IS NULL OR referrer = '' THEN 'direct'
      WHEN referrer LIKE '%monkeytravel.app%' THEN 'internal'
      WHEN referrer LIKE '%vercel.app%' OR referrer LIKE '%localhost%' THEN 'dev'
      WHEN referrer LIKE '%google%' THEN 'google'
      WHEN referrer LIKE '%bing%' THEN 'bing'
      WHEN referrer LIKE '%facebook%' OR referrer LIKE '%fb.com%' OR referrer LIKE '%fbclid%' THEN 'facebook'
      WHEN referrer LIKE '%instagram%' THEN 'instagram'
      WHEN referrer LIKE '%twitter%' OR referrer LIKE '%t.co%' OR referrer LIKE '%x.com%' THEN 'twitter'
      WHEN referrer LIKE '%linkedin%' THEN 'linkedin'
      WHEN referrer LIKE '%reddit%' THEN 'reddit'
      WHEN referrer LIKE '%youtube%' THEN 'youtube'
      WHEN referrer LIKE '%tiktok%' THEN 'tiktok'
      ELSE 'other'
    END as source,
    COUNT(*) as count
  FROM page_views
  GROUP BY 1
  ORDER BY count DESC;
$function$;

CREATE OR REPLACE FUNCTION public.get_time_to_first_trip()
RETURNS TABLE(avg_hours numeric, median_hours numeric, users_count bigint, within_1h bigint, within_24h bigint, within_7d bigint)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH first_trips AS (
    SELECT
      u.id,
      EXTRACT(EPOCH FROM (MIN(t.created_at) - u.created_at)) / 3600.0 as hours_to_trip
    FROM users u
    JOIN trips t ON t.user_id = u.id
    GROUP BY u.id, u.created_at
  )
  SELECT
    ROUND(AVG(hours_to_trip)::numeric, 1) as avg_hours,
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY hours_to_trip)::numeric, 1) as median_hours,
    COUNT(*) as users_count,
    COUNT(*) FILTER (WHERE hours_to_trip <= 1) as within_1h,
    COUNT(*) FILTER (WHERE hours_to_trip <= 24) as within_24h,
    COUNT(*) FILTER (WHERE hours_to_trip <= 168) as within_7d
  FROM first_trips;
$function$;

CREATE OR REPLACE FUNCTION public.get_page_views_daily_trend()
RETURNS TABLE(date text, views bigint, unique_visitors bigint)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT
    to_char(created_at, 'YYYY-MM-DD') as date,
    COUNT(*) as views,
    COUNT(DISTINCT concat(
      coalesce(user_agent, ''),
      coalesce(country_code, ''),
      coalesce(city, '')
    )) as unique_visitors
  FROM page_views
  WHERE created_at >= NOW() - INTERVAL '90 days'
  GROUP BY 1
  ORDER BY 1;
$function$;

CREATE OR REPLACE FUNCTION public.get_page_views_by_section()
RETURNS TABLE(section text, count bigint, unique_visitors bigint)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT
    CASE
      WHEN path ~ '^/(es|it)?/?$' THEN 'landing'
      WHEN path LIKE '%/trips%' THEN 'trips'
      WHEN path LIKE '%/auth%' OR path LIKE '%/login%' OR path LIKE '%/signup%' THEN 'auth'
      WHEN path LIKE '%/blog%' THEN 'blog'
      WHEN path LIKE '%/destinations%' THEN 'destinations'
      WHEN path LIKE '%/profile%' THEN 'profile'
      WHEN path LIKE '%/admin%' THEN 'admin'
      ELSE 'other'
    END as section,
    COUNT(*) as count,
    COUNT(DISTINCT concat(
      coalesce(user_agent, ''),
      coalesce(country_code, ''),
      coalesce(city, '')
    )) as unique_visitors
  FROM page_views
  GROUP BY 1
  ORDER BY count DESC;
$function$;
