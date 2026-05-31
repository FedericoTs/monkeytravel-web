-- wizard_step_events — server-side funnel telemetry for /trips/new.
--
-- Why: today the wizard fires PostHog events for each step, but we have
-- no SQL-queryable record of the funnel. That makes ad-hoc cross-cuts
-- (e.g. "what % of anonymous sessions from /backpacker land on
-- step_2_vibes and then abandon?") painful — PostHog can't join against
-- Supabase tables (users.acquisition_source, trips, referrals, etc).
--
-- This table is **additive** to the existing PostHog tracking. PostHog
-- stays the canonical product-analytics surface; this table is the
-- relational mirror used for admin dashboards, conversion SQL, and
-- ghost-user investigations (see Task #285).
--
-- DESIGN
--
-- One row per wizard step transition. session_id is the same value
-- middleware writes to the mt_session_id cookie (see
-- lib/supabase/middleware.ts:29-30) so we can stitch a single visitor's
-- step events into a funnel in pure SQL. user_id is NULL for anonymous
-- sessions and populated post-signup so referral/acquisition_source
-- joins work for the slice of users who reach Save.
--
-- step is constrained to a closed enum — the wizard surface is small
-- (2 steps + generation + result + save terminal states + abandoned),
-- and the enum prevents typos polluting the funnel. Adding a step is
-- a one-line migration.
--
-- destination / duration_days / group_size / backpacker_mode / locale
-- are denormalized into the row rather than fetched at query time so
-- cohort SQL stays cheap and survives even if the eventual trip gets
-- deleted (anonymous sessions never produce a trip but we still want
-- the cohort math).
--
-- ZERO RISK to existing flows: pure addition, no existing-table ALTERs.
-- POST /api/wizard-event is fire-and-forget on the client; a 500 here
-- does not block generation or save.

-- =====================================================
-- Table: wizard_step_events
-- =====================================================
CREATE TABLE IF NOT EXISTS public.wizard_step_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Matches the mt_session_id cookie set by middleware on first
    -- visit. text (not uuid) because middleware mints with
    -- crypto.randomUUID() but older sessions or test fixtures may
    -- have differently-shaped values; text keeps inserts forgiving.
    session_id TEXT NOT NULL,
    -- NULL for anonymous wizard sessions (the majority). Populated
    -- once the user signs up so post-save funnel joins to users /
    -- acquisition_source / referrals work.
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    -- Closed enum — must mirror the trackWizardEvent() call sites in
    -- app/[locale]/trips/new/NewTripWizard.tsx. Adding a step here
    -- requires updating both sides in the same PR.
    step TEXT NOT NULL CHECK (step IN (
        'step_1_destination_dates',
        'step_2_vibes',
        'generating',
        'result',
        'save_clicked',
        'saved',
        'abandoned'
    )),
    entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Denormalized funnel context. All optional — early steps don't
    -- know duration, anonymous sessions never set user_id, etc.
    destination TEXT,
    duration_days INTEGER,
    group_size TEXT,
    backpacker_mode BOOLEAN,
    locale TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.wizard_step_events IS
    'Server-side mirror of the wizard funnel events that also go to PostHog. Used for SQL cross-cuts and admin dashboards. INSERT-only from /api/wizard-event; SELECT gated to admin.';

-- Primary access pattern: replay one visitor's funnel in order.
CREATE INDEX IF NOT EXISTS wizard_step_events_session_created_idx
    ON public.wizard_step_events (session_id, created_at DESC);

-- Secondary access pattern: cohort dashboards grouping by step over
-- a time window ("how many sessions hit step_2_vibes in the last 7d").
CREATE INDEX IF NOT EXISTS wizard_step_events_step_created_idx
    ON public.wizard_step_events (step, created_at DESC);

-- =====================================================
-- Row-Level Security
-- =====================================================
ALTER TABLE public.wizard_step_events ENABLE ROW LEVEL SECURITY;

-- INSERT policy: any caller (anon OR authenticated) may insert a row
-- for themselves. If they pass a user_id, it MUST match auth.uid() —
-- this prevents an authenticated user from forging events attributed
-- to a different user. Anonymous inserts (user_id IS NULL) are always
-- allowed because the wizard is reachable without an account.
DROP POLICY IF EXISTS "wizard_step_events_insert_self" ON public.wizard_step_events;
CREATE POLICY "wizard_step_events_insert_self"
    ON public.wizard_step_events
    FOR INSERT
    WITH CHECK (
        user_id IS NULL
        OR user_id = auth.uid()
    );

-- SELECT policy: admin-only.
--
-- We intentionally do NOT add a "user can read their own events" rule
-- — there's no product surface that needs it, and keeping the read
-- side admin-gated minimises the blast radius if a session_id ever
-- leaks. Admin reads in the dashboard routes go through createAdminClient()
-- (service_role) which bypasses RLS entirely, so this policy mainly
-- exists to block the anon REST surface.
--
-- The check uses auth.jwt() -> email rather than is_admin() because
-- there's no SQL-side is_admin() helper in this repo — ADMIN_EMAILS
-- lives in lib/admin.ts. We mirror the hardcoded list here.
-- Updating ADMIN_EMAILS in code requires a follow-up migration to
-- this policy — a deliberate friction point so the security boundary
-- gets reviewed.
DROP POLICY IF EXISTS "wizard_step_events_select_admin" ON public.wizard_step_events;
CREATE POLICY "wizard_step_events_select_admin"
    ON public.wizard_step_events
    FOR SELECT
    USING (
        (auth.jwt() ->> 'email') IN (
            'federicosciuca@gmail.com',
            'azzolina.francesca@gmail.com',
            'marinoenrico3@gmail.com'
        )
    );

-- No UPDATE / DELETE policies — table is append-only. Admin cleanup
-- (if ever needed) goes through service_role + the dashboard, which
-- bypasses RLS.
