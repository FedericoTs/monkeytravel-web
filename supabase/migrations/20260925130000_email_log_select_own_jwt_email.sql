-- The "Recent email activity" list on /profile/notifications never loaded.
--
-- email_log_select_own compared recipient_email with
--   (select email from auth.users where id = auth.uid())
-- and the authenticated role cannot read auth.users, so every read through
-- the policy failed with "permission denied for table users":
-- /api/notifications/email-log answered 500 on every call (Vercel runtime
-- errors, oldest retained 2026-08-31), and the page showed an empty history.
--
-- The signed-in user's email is in their JWT: compare with that. recipient_email
-- is stored lowercased (lib/email/send.ts); lower() keeps the match exact even
-- if a claim ever arrives mixed-case. Scoped to authenticated: anon has no
-- business reading email history, and had no working path to it anyway.
--
-- Rehearsed on production 2026-09-25 in a rolled-back transaction, as a real
-- user: own rows 1/1 visible, other users' rows 0, anon 0.
--
-- Rollback: recreate the previous policy:
--   create policy email_log_select_own on public.email_log for select
--     using (recipient_email = (select email from auth.users where id = (select auth.uid())));

drop policy if exists email_log_select_own on public.email_log;

create policy email_log_select_own on public.email_log
  for select
  to authenticated
  using (recipient_email = lower((select auth.jwt()) ->> 'email'));
