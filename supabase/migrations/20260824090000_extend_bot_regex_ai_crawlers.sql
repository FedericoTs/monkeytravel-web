-- 2026-08-24 — Extend the page-view bot regex to cover AI crawlers.
--
-- WHY: the 2026-06-21 filter (see 20260621_filter_bots_from_page_view_aggregations.sql)
-- catches anything with "bot" in the UA, which happens to cover GPTBot,
-- Googlebot, PerplexityBot and OAI-SearchBot. It MISSES the ones without the
-- word: ChatGPT-User, Claude-Web and anthropic-ai.
--
-- That is not a rounding error. Measured 2026-08-24 over 24h of page_views:
--   ChatGPT-User   456   <-- largest identified crawler, counted as HUMAN
--   Googlebot      118       (already filtered)
--   bingbot         45       (already filtered)
--   OAI-SearchBot   37       (already filtered)
--   PerplexityBot   18       (already filtered)
-- So every admin dashboard number was inflated by ~456 fake "human" views/day,
-- and the geo breakdown attributed them to wherever OpenAI egresses from.
--
-- Also adds the SEO-tool and generic-client crawlers (Semrush, Ahrefs, Bytespider,
-- Amazonbot, DotBot, MJ12, go-http, node-fetch, axios) for the same reason.
--
-- NOTE this is the READ side only. trackPageView (lib/supabase/middleware.ts)
-- still writes every row, deliberately: the AI-crawler rows are the earliest
-- available signal that the GEO work (Google-Extended unblocked 2026-08-21,
-- ~540 URLs pushed to IndexNow) is landing. Filter on read, keep on write.
--
-- Unfiltered scrapers using a plain Chrome UA remain the largest bucket and
-- cannot be caught this way — treat filtered numbers as an upper bound and
-- cross-check against PostHog, which is client-side and naturally bot-free.

CREATE OR REPLACE FUNCTION public.get_page_views_by_city()
 RETURNS TABLE(city text, country_code text, count bigint)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT pv.city, pv.country_code, COUNT(*)::bigint as count
  FROM page_views pv
  WHERE pv.city IS NOT NULL
    AND (pv.user_agent IS NULL OR pv.user_agent !~* '(bot|crawl|spider|slurp|uptime|sentry|headless|monitor|pingdom|lighthouse|curl|wget|scrapy|facebookexternalhit|whatsapp|telegrambot|python-requests|chatgpt-user|claude-web|anthropic|oai-search|perplexity|bytespider|amazonbot|semrush|ahrefs|dotbot|mj12|go-http|node-fetch|axios)')
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
    AND (pv.user_agent IS NULL OR pv.user_agent !~* '(bot|crawl|spider|slurp|uptime|sentry|headless|monitor|pingdom|lighthouse|curl|wget|scrapy|facebookexternalhit|whatsapp|telegrambot|python-requests|chatgpt-user|claude-web|anthropic|oai-search|perplexity|bytespider|amazonbot|semrush|ahrefs|dotbot|mj12|go-http|node-fetch|axios)')
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
  WHERE (user_agent IS NULL OR user_agent !~* '(bot|crawl|spider|slurp|uptime|sentry|headless|monitor|pingdom|lighthouse|curl|wget|scrapy|facebookexternalhit|whatsapp|telegrambot|python-requests|chatgpt-user|claude-web|anthropic|oai-search|perplexity|bytespider|amazonbot|semrush|ahrefs|dotbot|mj12|go-http|node-fetch|axios)')
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
    AND (user_agent IS NULL OR user_agent !~* '(bot|crawl|spider|slurp|uptime|sentry|headless|monitor|pingdom|lighthouse|curl|wget|scrapy|facebookexternalhit|whatsapp|telegrambot|python-requests|chatgpt-user|claude-web|anthropic|oai-search|perplexity|bytespider|amazonbot|semrush|ahrefs|dotbot|mj12|go-http|node-fetch|axios)')
  GROUP BY 1
  ORDER BY 1;
$function$;
