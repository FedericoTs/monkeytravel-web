-- Plans kept for signed-out planners. Every plan gets a private link that
-- puts it back in the planner on any device; a plan lives 30 days from when it
-- was kept or last opened. Nothing paid runs on it (lib/plans/kept-plan.ts).
--
-- Read and written only by the service role (app/api/plans), keyed on the
-- exact token. Changing a plan also needs the key the creating browser holds;
-- only its SHA-256 is stored.

create table if not exists public.kept_plans (
  token text primary key,
  key_hash text not null,
  plan jsonb not null,
  -- The browser's mt_session_id, so probe and automation sessions can be
  -- left out of any count.
  session_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  opens integer not null default 0,
  last_opened_at timestamptz,
  constraint kept_plans_token_shape check (token ~ '^[A-Za-z0-9_-]{22}$'),
  constraint kept_plans_key_hash_shape check (key_hash ~ '^[0-9a-f]{64}$')
);

alter table public.kept_plans enable row level security;
revoke all on table public.kept_plans from public, anon, authenticated;

create index if not exists kept_plans_expires_at_idx on public.kept_plans (expires_at);

-- One open of a kept plan: counted, kept 30 more days from now, returned.
create or replace function public.open_kept_plan(p_token text)
returns jsonb
language sql
security invoker
set search_path = public
as $$
  update public.kept_plans
     set opens = opens + 1,
         last_opened_at = now(),
         expires_at = greatest(expires_at, now() + interval '30 days')
   where token = p_token
     and expires_at > now()
  returning jsonb_build_object('plan', plan, 'expires_at', expires_at);
$$;

revoke execute on function public.open_kept_plan(text) from public, anon, authenticated;
grant execute on function public.open_kept_plan(text) to service_role;

select cron.schedule(
  'expire-kept-plans',
  '20 3 * * *',
  $$delete from public.kept_plans where expires_at < now()$$
);
