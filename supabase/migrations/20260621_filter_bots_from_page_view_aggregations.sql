-- 2026-06-21 — Strip bot traffic from the admin page-view aggregation RPCs
-- (dashboard hygiene + honest SEO geo signals).
-- Applied to prod via apply_migration ("filter_bots_from_page_view_aggregations").
--
-- WHY: page_views was dominated by our OWN SentryUptimeBot — it made
-- "Frankfurt" look like the #1 city (51,731 views, 99% bot) and Groningen #2
-- (also 99% bot), burying the real top market (Milan, IT — 9,140 real views).
-- All four get_page_views_* RPCs aggregated raw rows with no UA filter. Add a
-- bot user_agent exclusion to each (NULL UAs are kept — legit clients may omit
-- it; SentryUptimeBot has a matching UA so it's caught). Also teach the section
-- classifier the new 'pt' landing locale.
--
-- Verified after apply: get_page_views_by_city() now returns Milan #1, Dallas,
-- Singapore... — Frankfurt/Groningen bot-cities gone.

CREATE OR REPLACE FUNCTION public.get_page_views_by_city()
 RETURNS TABLE(city text, country_code text, count bigint)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT pv.city, pv.country_code, COUNT(*)::bigint as count
  FROM page_views pv
  WHERE pv.city IS NOT NULL
    AND (pv.user_agent IS NULL OR pv.user_agent !~* '(bot|crawl|spider|slurp|uptime|sentry|headless|monitor|pingdom|lighthouse|curl|wget|scrapy|facebookexternalhit|whatsapp|telegrambot|python-requests)')
  GROUP BY pv.city, pv.country_code
  ORDER BY count DESC
  LIMIT 20;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_page_views_by_country()
 RETURNS TABLE(country_code text, count bigint)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT pv.country_code, COUNT(*)::bigint as count
  FROM page_views pv
  WHERE pv.country_code IS NOT NULL
    AND (pv.user_agent IS NULL OR pv.user_agent !~* '(bot|crawl|spider|slurp|uptime|sentry|headless|monitor|pingdom|lighthouse|curl|wget|scrapy|facebookexternalhit|whatsapp|telegrambot|python-requests)')
  GROUP BY pv.country_code
  ORDER BY count DESC
  LIMIT 20;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_page_views_by_section()
 RETURNS TABLE(section text, count bigint, unique_visitors bigint)
 LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
  SELECT
    CASE
      WHEN path ~ '^/(es|it|pt)?/?$' THEN 'landing'
      WHEN path LIKE '%/trips%' THEN 'trips'
      WHEN path LIKE '%/auth%' OR path LIKE '%/login%' OR path LIKE '%/signup%' THEN 'auth'
      WHEN path LIKE '%/blog%' THEN 'blog'
      WHEN path LIKE '%/destinations%' THEN 'destinations'
      WHEN path LIKE '%/profile%' THEN 'profile'
      WHEN path LIKE '%/admin%' THEN 'admin'
      ELSE 'other'
    END as section,
    COUNT(*) as count,
    COUNT(DISTINCT concat(coalesce(user_agent,''),coalesce(country_code,''),coalesce(city,''))) as unique_visitors
  FROM page_views
  WHERE (user_agent IS NULL OR user_agent !~* '(bot|crawl|spider|slurp|uptime|sentry|headless|monitor|pingdom|lighthouse|curl|wget|scrapy|facebookexternalhit|whatsapp|telegrambot|python-requests)')
  GROUP BY 1
  ORDER BY count DESC;
$function$;

CREATE OR REPLACE FUNCTION public.get_page_views_daily_trend()
 RETURNS TABLE(date text, views bigint, unique_visitors bigint)
 LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
  SELECT
    to_char(created_at, 'YYYY-MM-DD') as date,
    COUNT(*) as views,
    COUNT(DISTINCT concat(coalesce(user_agent,''),coalesce(country_code,''),coalesce(city,''))) as unique_visitors
  FROM page_views
  WHERE created_at >= NOW() - INTERVAL '90 days'
    AND (user_agent IS NULL OR user_agent !~* '(bot|crawl|spider|slurp|uptime|sentry|headless|monitor|pingdom|lighthouse|curl|wget|scrapy|facebookexternalhit|whatsapp|telegrambot|python-requests)')
  GROUP BY 1
  ORDER BY 1;
$function$;
