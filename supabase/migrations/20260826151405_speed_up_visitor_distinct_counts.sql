-- Performance follow-up to 20260826120000_fix_remaining_admin_rpc_search_path.sql.
--
-- That migration made these two functions RUN for the first time in months
-- (they had been throwing 42P01 instantly). Restoring them exposed what they
-- actually cost: page_views is 602,012 rows / 234 MB, and both were doing
--
--     COUNT(DISTINCT concat(user_agent, country_code, city))
--
-- COUNT(DISTINCT <expr>) forces a sort-based aggregate that Postgres cannot
-- parallelise. Counting the rows of a DISTINCT subquery instead lets the
-- planner use a parallel HashAggregate over a Parallel Seq Scan.
--
-- Measured on prod (sevfbahwmlbdlnbhqwyi), warm:
--
--   count_unique_visitors()   13,971 ms  ->  5,093 ms
--   get_conversion_funnel()   25,040 ms  ->  5,630 ms
--
-- Identical results: both report 24,680 unique visitors, and the funnel's
-- 'visitors' step equals count_unique_visitors() exactly.
--
-- No index is involved. An expression index on the concat was considered and
-- rejected: user_agent is long, so the index would be large on a 234 MB
-- table, and COUNT(DISTINCT) would not have used it anyway -- the win here is
-- entirely from letting the aggregate go parallel.
--
-- Signature, return type, LANGUAGE, STABLE and search_path are reproduced
-- exactly as pg_get_functiondef() reported them, so nothing but the query
-- shape changes.
--
-- NOTE: the route calls BOTH of these, so the 600k-row scan still happens
-- twice per dashboard load. get_conversion_funnel() already returns the same
-- visitor number as its first step, so app/api/admin/stats/route.ts could
-- drop the separate count_unique_visitors() call and read it from the funnel.
-- Left alone here to keep this migration purely a database change.

CREATE OR REPLACE FUNCTION public.count_unique_visitors()
 RETURNS TABLE(count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT count(*) FROM (
    SELECT DISTINCT concat(
      coalesce(user_agent, ''),
      coalesce(country_code, ''),
      coalesce(city, '')
    ) FROM page_views
  ) t;
$function$;

CREATE OR REPLACE FUNCTION public.get_conversion_funnel()
 RETURNS TABLE(step text, count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT 'visitors' AS step, (
    SELECT count(*) FROM (
      SELECT DISTINCT concat(
        coalesce(user_agent, ''),
        coalesce(country_code, ''),
        coalesce(city, '')
      ) FROM page_views
    ) t
  )
  UNION ALL
  SELECT 'signups', COUNT(*) FROM users
  UNION ALL
  SELECT 'trip_creators', COUNT(DISTINCT user_id) FROM trips
  UNION ALL
  SELECT 'shared_trips', COUNT(*) FROM trips WHERE share_token IS NOT NULL;
$function$;
