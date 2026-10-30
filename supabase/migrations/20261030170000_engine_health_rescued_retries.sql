-- engine_health() counts generations, not requests. When a generation's stream
-- fails, the planner asks the JSON route again under the same generation_id;
-- if that succeeds, the traveller got their plan and the generation is not a
-- failure. A generation is counted once it is three minutes old, so a retry
-- still running is not taken for a failure.

create or replace function public.engine_health(p_minutes integer default 60)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
with requests as (
  select coalesce(l.request_params->>'generation_id', l.id::text) as generation,
         l.timestamp,
         l.response_status
  from api_request_logs l
  where l.timestamp > now() - make_interval(mins => p_minutes + 3)
    and l.endpoint in ('/api/ai/generate/stream', '/api/ai/generate')
    and not coalesce((l.request_params->>'is_admin')::boolean, false)
),
generations as (
  select bool_or(response_status >= 400) and not bool_or(response_status = 200) as failed
  from requests
  group by generation
  having min(timestamp) <= now() - interval '3 minutes'
)
select jsonb_build_object(
  'minutes', p_minutes,
  'requests', (select count(*) from generations),
  'errors', (select count(*) from generations where failed),
  'client_generating', (select count(distinct w.session_id) from wizard_step_events_human w
                        where w.created_at > now() - make_interval(mins => p_minutes)
                          and w.step = 'generating' and w.session_id not like 'e2eprobe-%'),
  'client_failed', (select count(distinct w.session_id) from wizard_step_events_human w
                    where w.created_at > now() - make_interval(mins => p_minutes)
                      and w.step = 'generation_failed' and w.session_id not like 'e2eprobe-%'),
  'ok_last_3h', (select count(*) from api_request_logs l
                 where l.timestamp > now() - interval '3 hours'
                   and l.endpoint in ('/api/ai/generate/stream', '/api/ai/generate')
                   and l.response_status = 200)
);
$$;

revoke execute on function public.engine_health(integer) from public, anon, authenticated;
grant execute on function public.engine_health(integer) to service_role;
