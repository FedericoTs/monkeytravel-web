-- Non-human page views (bots, link prefetches, sessions labelled automation:
-- every row page_views_human leaves out) are kept 14 days; human ones keep
-- 180 as before. Daily totals of both stay in page_view_rollup ('all' and
-- 'total'), and the rollup and labelling jobs only look back 3 days.

create or replace function public.purge_old_analytics_rows()
returns table (page_views_deleted bigint, api_logs_deleted bigint)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pv bigint := 0;
  v_nh bigint := 0;
  v_api bigint := 0;
begin
  delete from public.page_views
   where id in (
     select id from public.page_views
      where created_at < now() - interval '180 days'
      order by created_at
      limit 20000
   );
  get diagnostics v_pv = row_count;

  delete from public.page_views
   where id in (
     select p.id from public.page_views p
      where p.created_at < now() - interval '14 days'
        and (p.is_bot or p.is_prefetch or exists (
          select 1 from public.page_view_session_labels l
           where l.session_id = p.session_id
             and l.day = p.created_at::date
             and l.is_automation))
      order by p.created_at
      limit 50000
   );
  get diagnostics v_nh = row_count;

  delete from public.api_request_logs
   where id in (
     select id from public.api_request_logs
      where timestamp < now() - interval '365 days'
      order by timestamp
      limit 5000
   );
  get diagnostics v_api = row_count;

  page_views_deleted := v_pv + v_nh;
  api_logs_deleted := v_api;
  return next;
end
$function$;

revoke execute on function public.purge_old_analytics_rows() from public, anon, authenticated;
grant execute on function public.purge_old_analytics_rows() to service_role;
