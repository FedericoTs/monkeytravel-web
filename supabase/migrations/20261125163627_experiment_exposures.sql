-- Which arm of which experiment each visitor was shown: one row per experiment and browser session, written the
-- first time the arms differ for them (lib/experiments). Every visitor, whatever they chose in the cookie banner;
-- PostHog gets the arm as a property only from visitors who accepted analytics. Server-only: the app's service role
-- writes it and the experiment reads read it.
create table if not exists public.experiment_exposures (
  id uuid primary key default gen_random_uuid(),
  experiment text not null check (experiment ~ '^[a-z0-9][a-z0-9_]{1,39}$'),
  arm text not null check (arm ~ '^[a-z0-9][a-z0-9_]{0,29}$'),
  session_id text not null check (char_length(session_id) between 1 and 100),
  created_at timestamptz not null default now(),
  unique (experiment, session_id)
);

create index if not exists experiment_exposures_experiment_created_idx
  on public.experiment_exposures (experiment, created_at);

alter table public.experiment_exposures enable row level security;
revoke all on table public.experiment_exposures from public, anon, authenticated;

comment on table public.experiment_exposures is
  'One row per experiment and browser session: the arm shown the first time the arms differed. Server-only (service role).';
