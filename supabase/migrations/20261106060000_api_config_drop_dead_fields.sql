-- Nothing reads these. Daily limits are counted in lib/api-gateway/api-control.ts, and
-- monthly limits were never enforced.
alter table public.api_config
  drop column if exists monthly_limit,
  drop column if exists current_daily_count,
  drop column if exists current_monthly_count,
  drop column if exists last_reset_daily,
  drop column if exists last_reset_monthly;
