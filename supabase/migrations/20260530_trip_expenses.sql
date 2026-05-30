-- trip_expenses — post-booking spend tracking for trips.
--
-- Closes task #220. Pairs with the existing booking_required flag on
-- activities (which tracks estimates) — this table records actual
-- spend after the user books, so the trip page can show "estimated
-- 730 EUR vs actual 612 EUR" plus a per-category breakdown.
--
-- DESIGN
--
-- One row per expense entry. Owner + every active collaborator (any
-- role) can SELECT all expenses on the trip; only the creator or the
-- trip owner can UPDATE/DELETE their own entries. This mirrors the
-- collaboration model in trip_collaborators / trip_invites: visibility
-- is shared, mutation is scoped to the actor + owner.
--
-- Amount uses NUMERIC(12,2) — handles up to 9,999,999,999.99 per row,
-- which is more than enough for any legitimate trip expense and avoids
-- the float-rounding bugs that come with REAL/DOUBLE. Currency is a
-- free-form 3-letter ISO 4217 code (constrained at the app layer, not
-- the DB layer, so we can add new currencies without a migration).
-- Multi-currency is intentional: trips often span countries; the UI
-- groups totals by currency rather than forcing client-side FX
-- conversion (which would need a live rate snapshot per expense).
--
-- spent_on (DATE) is separate from created_at — users often log
-- expenses days after they happen. Defaults to today so the common
-- case (logging an expense as you incur it) is zero-friction.
--
-- ZERO RISK to existing flows: pure addition, no existing-table ALTERs.

-- =====================================================
-- Table: trip_expenses
-- =====================================================
CREATE TABLE IF NOT EXISTS public.trip_expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
    -- Who logged this expense. NULL only if the original logger had
    -- their auth.users row deleted (account deletion) — we keep the
    -- expense visible to remaining collaborators rather than cascading
    -- the delete and losing trip history.
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    -- ISO 4217 currency code, uppercased. App-layer validates known
    -- codes. NUMERIC for amount avoids float drift.
    amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
    currency TEXT NOT NULL CHECK (length(currency) = 3),
    -- Category for filtering + breakdown chart. Restricted to a known
    -- set; adding a category is a one-line migration. "other" is the
    -- catch-all so users never get blocked on edge cases.
    category TEXT NOT NULL CHECK (category IN (
        'transport', 'accommodation', 'food', 'activity', 'shopping', 'other'
    )),
    -- Free-form note. Capped at 280 chars at the app layer to keep
    -- the row scannable in the timeline view.
    description TEXT,
    -- Date the expense happened (vs created_at = when it was logged).
    spent_on DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.trip_expenses IS
    'Post-booking spend tracking. Owner + collaborators SELECT all; creator + owner UPDATE/DELETE own.';

-- Primary access pattern: list expenses on a trip page, newest first
-- within a chosen day. trip_id leads so the partial-key prefix scan
-- is tight; spent_on DESC is secondary so day-grouped views are sorted.
CREATE INDEX IF NOT EXISTS trip_expenses_trip_spent_on_idx
    ON public.trip_expenses (trip_id, spent_on DESC, created_at DESC);

-- "How much has THIS user spent on THIS trip" — used by the per-user
-- breakdown card. Worth its own index because the trip_id lookup alone
-- returns the full set and filtering by created_by in JS is wasteful
-- once a long trip has 100+ expenses.
CREATE INDEX IF NOT EXISTS trip_expenses_trip_creator_idx
    ON public.trip_expenses (trip_id, created_by)
    WHERE created_by IS NOT NULL;

-- =====================================================
-- updated_at trigger — match the convention used elsewhere
-- =====================================================
CREATE OR REPLACE FUNCTION public.touch_trip_expenses_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trip_expenses_touch_updated_at ON public.trip_expenses;
CREATE TRIGGER trip_expenses_touch_updated_at
    BEFORE UPDATE ON public.trip_expenses
    FOR EACH ROW
    EXECUTE FUNCTION public.touch_trip_expenses_updated_at();

-- =====================================================
-- Row-Level Security
-- =====================================================
ALTER TABLE public.trip_expenses ENABLE ROW LEVEL SECURITY;

-- Helper: is the current auth.uid() either the trip owner or an active
-- collaborator? Used by SELECT + INSERT policies.
--
-- We inline the check inside each policy (rather than building yet
-- another SECURITY DEFINER helper) because trip_collaborators already
-- has its own RLS tightened in #171, so a recursive RLS evaluation
-- here is correct + safe.

DROP POLICY IF EXISTS "trip_expenses_select_member" ON public.trip_expenses;
CREATE POLICY "trip_expenses_select_member"
    ON public.trip_expenses
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.trips t
            WHERE t.id = trip_expenses.trip_id
              AND t.user_id = auth.uid()
        )
        OR EXISTS (
            SELECT 1 FROM public.trip_collaborators tc
            WHERE tc.trip_id = trip_expenses.trip_id
              AND tc.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "trip_expenses_insert_member" ON public.trip_expenses;
CREATE POLICY "trip_expenses_insert_member"
    ON public.trip_expenses
    FOR INSERT
    WITH CHECK (
        auth.uid() = created_by
        AND (
            EXISTS (
                SELECT 1 FROM public.trips t
                WHERE t.id = trip_id
                  AND t.user_id = auth.uid()
            )
            OR EXISTS (
                SELECT 1 FROM public.trip_collaborators tc
                WHERE tc.trip_id = trip_expenses.trip_id
                  AND tc.user_id = auth.uid()
            )
        )
    );

-- UPDATE / DELETE: only the creator or the trip owner. Collaborators
-- can SEE every expense (transparency) but can't edit someone else's
-- entry (audit integrity). Owner can override — important for the
-- "this person left the trip and we need to fix their typo" case.
DROP POLICY IF EXISTS "trip_expenses_update_creator_or_owner" ON public.trip_expenses;
CREATE POLICY "trip_expenses_update_creator_or_owner"
    ON public.trip_expenses
    FOR UPDATE
    USING (
        auth.uid() = created_by
        OR EXISTS (
            SELECT 1 FROM public.trips t
            WHERE t.id = trip_expenses.trip_id
              AND t.user_id = auth.uid()
        )
    )
    WITH CHECK (
        auth.uid() = created_by
        OR EXISTS (
            SELECT 1 FROM public.trips t
            WHERE t.id = trip_expenses.trip_id
              AND t.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "trip_expenses_delete_creator_or_owner" ON public.trip_expenses;
CREATE POLICY "trip_expenses_delete_creator_or_owner"
    ON public.trip_expenses
    FOR DELETE
    USING (
        auth.uid() = created_by
        OR EXISTS (
            SELECT 1 FROM public.trips t
            WHERE t.id = trip_expenses.trip_id
              AND t.user_id = auth.uid()
        )
    );
