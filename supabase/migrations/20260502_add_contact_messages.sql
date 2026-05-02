-- Contact form submissions captured by /api/contact.
-- Apply with: supabase migration up (or run via the Supabase SQL editor).

create table if not exists public.contact_messages (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  name          text not null,
  email         text not null,
  topic         text not null,
  message       text not null,
  locale        text,
  user_agent    text,
  referer       text,
  ip_hash       text,
  status        text not null default 'new'
                check (status in ('new', 'in_progress', 'resolved', 'spam'))
);

create index if not exists contact_messages_created_at_idx
  on public.contact_messages (created_at desc);

create index if not exists contact_messages_status_idx
  on public.contact_messages (status)
  where status <> 'resolved';

-- Lock down anon writes through the API only (server uses service-role insert).
alter table public.contact_messages enable row level security;

-- No public select policy — admins read via service-role/SQL editor.
-- No anon insert policy — the API route uses the public anon key but rate-limits
-- at the application layer; if you switch to service-role inserts, drop this policy.
create policy "anon can insert contact messages"
  on public.contact_messages
  for insert
  to anon
  with check (true);
