-- Observability for the ANONYMOUS assistant (highest-traffic AI surface).
-- The authed assistant persists to ai_conversations, but anon exchanges were
-- invisible — refusal/friction patterns (e.g. the Legoland case in session
-- replays, 2026-07-03 diagnosis) never appeared in our data. Service-role
-- only: RLS enabled with NO policies; the route writes fire-and-forget.
-- Applied to prod (sevfbahwmlbdlnbhqwyi) 2026-07-03 via MCP apply_migration.
CREATE TABLE IF NOT EXISTS public.anon_assistant_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  session_id text,
  locale text,
  destination text,
  user_message text NOT NULL,
  reply text,
  edit jsonb,
  error text
);
CREATE INDEX IF NOT EXISTS anon_assistant_logs_created_idx
  ON public.anon_assistant_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS anon_assistant_logs_session_idx
  ON public.anon_assistant_logs (session_id);
ALTER TABLE public.anon_assistant_logs ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: anon/authenticated can neither read nor write;
-- the service_role client bypasses RLS.
