-- UX10X Master Plan Phase 0.3 — funnel_events sink for the viral-loop events.
--
-- Records the crew/share loop: share_link_created (a trip's share_token is
-- minted), share_link_visited (someone opens /shared/[token]), vote_cast (an
-- anon friend votes), plan_own_clicked (a /shared visitor taps "plan your
-- own"). These do NOT fit wizard_step_events (its closed step CHECK, 1s
-- dedupe-bucket and denormalized wizard columns are wrong here), so a
-- dedicated lightweight table. Server events are written with the service-role
-- client (bypass RLS); the one client-fired event (plan_own_clicked, PR2c)
-- relies on the anon INSERT policy below.
--
-- Applied to prod (sevfbahwmlbdlnbhqwyi) 2026-07-03 via MCP apply_migration.

CREATE TABLE IF NOT EXISTS public.funnel_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL CHECK (event_type = ANY (ARRAY[
    'share_link_created'::text,
    'share_link_visited'::text,
    'vote_cast'::text,
    'plan_own_clicked'::text
  ])),
  trip_id uuid NULL REFERENCES public.trips(id) ON DELETE SET NULL,
  session_id text NULL,
  user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  anon_id text NULL,
  metadata jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS funnel_events_type_created_idx
  ON public.funnel_events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS funnel_events_trip_created_idx
  ON public.funnel_events (trip_id, created_at DESC);

ALTER TABLE public.funnel_events ENABLE ROW LEVEL SECURITY;

-- Anon/authed may INSERT their own row (self or null owner); mirrors
-- wizard_step_events_insert_self. Server writes use service-role -> bypass.
CREATE POLICY funnel_events_insert_self ON public.funnel_events
  FOR INSERT TO public
  WITH CHECK ((user_id IS NULL) OR (user_id = (SELECT auth.uid())));

-- Admin-only SELECT, mirroring wizard_step_events_select_admin (same 3 emails).
CREATE POLICY funnel_events_select_admin ON public.funnel_events
  FOR SELECT TO public
  USING (((SELECT auth.jwt()) ->> 'email') = ANY (ARRAY[
    'federicosciuca@gmail.com'::text,
    'azzolina.francesca@gmail.com'::text,
    'marinoenrico3@gmail.com'::text
  ]));
