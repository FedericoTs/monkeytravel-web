-- Paid-API calls and cost over [p_from, p_to), per API and per-call cost, for
-- the spend alert (app/api/cron/spend-alert), which prices each Places SKU
-- against Google's free monthly allowance. Summed here because PostgREST
-- returns at most 1,000 rows, and returned as one jsonb array because that cap
-- applies to a set too and per-token Gemini costs make many groups. Probe rows
-- are left out; request_params is NULL on most rows, hence the coalesce.

create or replace function public.api_spend_by_unit(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object('api_name', g.api_name, 'unit_usd', g.unit_usd, 'calls', g.calls, 'usd', g.usd)
      order by g.api_name, g.unit_usd
    ),
    '[]'::jsonb
  )
  from (
    select l.api_name, coalesce(l.cost_usd, 0) as unit_usd, count(*) as calls, coalesce(sum(l.cost_usd), 0) as usd
    from public.api_request_logs l
    where l."timestamp" >= p_from
      and l."timestamp" < p_to
      and not coalesce(l.request_params ? 'probe', false)
    group by l.api_name, coalesce(l.cost_usd, 0)
  ) g;
$$;

revoke execute on function public.api_spend_by_unit(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.api_spend_by_unit(timestamptz, timestamptz) to service_role;

comment on function public.api_spend_by_unit(timestamptz, timestamptz) is
  'Calls and summed cost_usd per (api_name, cost_usd) in api_request_logs over [p_from, p_to), probe rows left out, as one jsonb array. Service role only.';

notify pgrst, 'reload schema';
