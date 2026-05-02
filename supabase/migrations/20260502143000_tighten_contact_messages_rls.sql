-- Replace the always-true WITH CHECK with one that mirrors the
-- /api/contact route's validation. Doesn't fix the rate-limit bypass
-- (still need service-role for that) but caps abuse to realistic-shaped
-- messages — no megabyte blobs, no garbage topics, no missing emails.

drop policy if exists "anon can insert contact messages" on public.contact_messages;

create policy "anon can insert contact messages"
  on public.contact_messages
  for insert
  to anon
  with check (
    length(name) between 1 and 200
    and length(email) between 5 and 320
    and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    and topic in ('support', 'partnership', 'press', 'feedback', 'other')
    and length(message) between 10 and 5000
    and (locale is null or length(locale) <= 8)
    and (user_agent is null or length(user_agent) <= 500)
    and (referer is null or length(referer) <= 500)
    and (ip_hash is null or length(ip_hash) <= 64)
  );
