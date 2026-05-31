-- Day-9 Supabase advisor sweep: fix function_search_path_mutable on 5 RPCs.
-- Same defensive hardening as Day-4 fix #325 (5 admin analytics RPCs).
-- SET search_path TO '' closes the search-path-injection attack vector
-- where an attacker with object-creation privilege in their own schema
-- could hijack function execution.
--
-- These 5 functions were flagged WARN-level by the Supabase advisor:
--   public.hostelworld_stats_30d(timestamp with time zone)
--   public.hostelworld_stats_daily(timestamp with time zone, timestamp with time zone)
--   public.hostelworld_top_destinations(timestamp with time zone, integer)
--   public.set_wizard_dedupe_bucket()
--   public.touch_trip_expenses_updated_at()
--
-- All 5 verified safe to harden:
--   - Trigger funcs (set_wizard_dedupe_bucket, touch_trip_expenses_updated_at)
--     only touch NEW.* values and built-in funcs (NOW, FLOOR, EXTRACT).
--   - Hostelworld stats aggregates already qualify FROM with
--     public.hostelworld_clicks per their existing bodies.

ALTER FUNCTION public.hostelworld_stats_30d(timestamp with time zone)
  SET search_path TO '';
ALTER FUNCTION public.hostelworld_stats_daily(timestamp with time zone, timestamp with time zone)
  SET search_path TO '';
ALTER FUNCTION public.hostelworld_top_destinations(timestamp with time zone, integer)
  SET search_path TO '';
ALTER FUNCTION public.set_wizard_dedupe_bucket()
  SET search_path TO '';
ALTER FUNCTION public.touch_trip_expenses_updated_at()
  SET search_path TO '';
