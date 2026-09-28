-- Password-reset health for the ops cron (app/api/cron/auth-health).
--
-- A reset that silently fails throws nothing, so the only evidence is the
-- ratio of reset emails sent to passwords actually changed. GoTrue's audit log
-- cannot tell a reset request from a magic-code sign-in (both are
-- user_recovery_requested), so the email hook (app/api/auth/send-email)
-- records each auth email's type here, keyed by a hash of the address.

create table if not exists public.auth_email_events (
  id bigint generated always as identity primary key,
  action text not null,
  recipient_hash text not null,
  created_at timestamptz not null default now()
);
create index if not exists auth_email_events_action_created_idx on public.auth_email_events (action, created_at);
alter table public.auth_email_events enable row level security;
revoke all on table public.auth_email_events from public, anon, authenticated;

-- Reads the auth schema, so service-role only.
create or replace function public.auth_recovery_health(p_days integer default 14)
returns table (recoveries integer, recovery_users integer, password_changes integer)
language sql
security definer
set search_path to ''
as $$
  select
    (select count(*)::integer from public.auth_email_events
      where action = 'recovery' and created_at > now() - make_interval(days => greatest(p_days, 1))),
    (select count(distinct recipient_hash)::integer from public.auth_email_events
      where action = 'recovery' and created_at > now() - make_interval(days => greatest(p_days, 1))),
    (select count(*)::integer from auth.audit_log_entries
      where payload->>'action' in ('user_updated_password', 'user_modified')
        and created_at > now() - make_interval(days => greatest(p_days, 1)));
$$;

revoke execute on function public.auth_recovery_health(integer) from public, anon, authenticated;
grant execute on function public.auth_recovery_health(integer) to service_role;
