-- Reminders before a kept plan's trip (lib/plans/plan-reminders.ts), for a planner with no account who ticked
-- "remind me before the trip" when the plan was emailed to them. A row is that tick: the address, the plan, when it
-- was given and which words it answered. Only the reminders are ever sent from it. A row goes from the trip's first
-- day (the daily /api/cron/plan-reminders run), at once from any reminder's stop link, or with its plan.
--
-- Read and written only by the service role.

create table if not exists public.plan_reminders (
  id uuid primary key default gen_random_uuid(),
  kept_token text not null references public.kept_plans (token) on delete cascade,
  email text not null check (char_length(email) between 3 and 320),
  locale text check (locale is null or char_length(locale) <= 8),
  consent_version text not null check (char_length(consent_version) between 1 and 20),
  consented_at timestamptz not null default now(),
  sent_slots text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (kept_token, email)
);

alter table public.plan_reminders enable row level security;
revoke all on table public.plan_reminders from public, anon, authenticated;

comment on table public.plan_reminders is
  'A ticked "remind me before the trip" for a kept plan: the address, when, and which words. Server-only (service role). Deleted from the trip''s first day, on unsubscribe, or with its plan.';
