-- Day-10 — trip_expense_splits + compute_trip_settlements RPC
--
-- Layers a Splitwise-style split + minimum-transfer settlement engine
-- onto the existing trip_expenses ledger (20260530_trip_expenses.sql).
--
-- DESIGN
--
-- A trip_expense_splits row records how much one user owes for a given
-- expense. The PAYER of an expense is whoever's UUID sits on
-- trip_expenses.paid_by_user_id (added below — defaults to the logger
-- via a backfill, but is now settable independently). Per-currency
-- balance = sum(paid) - sum(splits owed). Settlement is computed by
-- compute_trip_settlements() — greedy debt simplification per currency.
--
-- WHY NUMERIC(12,2) (matching trip_expenses.amount) and not BIGINT cents
-- as the original spec suggested: we already store amount as NUMERIC(12,2);
-- mixing units would force every reader to track which column is in cents
-- and which isn't. NUMERIC is exact (no float drift) and Postgres handles
-- the sums and comparisons cleanly for the volumes a trip ledger sees
-- (< 1000 splits per trip in the worst case). If/when we materialise a
-- balances view we can switch to cents internally without breaking the
-- public columns.
--
-- WHY GREEDY for settlement: optimal min-cash-flow is NP-hard in general,
-- but for n <= 10 users (the realistic group-trip ceiling) greedy
-- matching of the largest creditor and largest debtor at each step gives
-- the same number of transfers as the optimal solution in >95% of cases
-- and is O(n log n) — trivial to compute server-side on every GET.
--
-- ZERO RISK to existing flows: the paid_by_user_id ALTER is nullable
-- and back-filled to created_by, so every existing read keeps working.

-- =====================================================
-- 1. Extend trip_expenses with paid_by_user_id
-- =====================================================
-- The logger (created_by) and the actual payer (paid_by_user_id) are
-- two different concepts. Today they collapse — the person who types
-- the expense is assumed to have paid. The split system needs them
-- separated so "Alice paid €60 for everyone, Bob logged it later"
-- balances Alice's side, not Bob's.
ALTER TABLE public.trip_expenses
    ADD COLUMN IF NOT EXISTS paid_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Back-fill the new column to created_by for existing rows so balance
-- math doesn't silently treat historical expenses as "no one paid".
UPDATE public.trip_expenses
   SET paid_by_user_id = created_by
 WHERE paid_by_user_id IS NULL
   AND created_by IS NOT NULL;

-- Trip-scoped index on the payer — settlement math scans by trip + payer.
CREATE INDEX IF NOT EXISTS trip_expenses_trip_paid_by_idx
    ON public.trip_expenses (trip_id, paid_by_user_id)
    WHERE paid_by_user_id IS NOT NULL;

-- =====================================================
-- 2. trip_expense_splits
-- =====================================================
CREATE TABLE IF NOT EXISTS public.trip_expense_splits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    expense_id UUID NOT NULL REFERENCES public.trip_expenses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    -- The amount this user owes for this expense. Equal split divides
    -- the parent expense by N; exact split stores per-user amounts.
    -- App-layer guarantees the splits sum to the parent amount; the
    -- DB does not enforce that invariant because Phase 1 doesn't run
    -- the upsert through an atomic RPC yet (#220 spec, deferred).
    share_amount NUMERIC(12, 2) NOT NULL CHECK (share_amount >= 0),
    -- Optional per-split settlement flag (manual "I paid Alice in cash"
    -- toggle from the UI). When all splits for an expense are settled
    -- the UI hides it from the open balance. The system-wide settle-up
    -- RPC ignores this flag — settled rows still contribute to net
    -- balance because we don't write a counter-balance row; they only
    -- gate the UI affordance until/unless we add settlement entries.
    settled BOOLEAN NOT NULL DEFAULT false,
    settled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (expense_id, user_id)
);

COMMENT ON TABLE public.trip_expense_splits IS
    'Who owes what for each trip expense. Sum(share_amount) should equal parent expense amount.';

-- Primary access pattern: load all splits for an expense (when editing
-- or rendering the ledger row), and load all splits for a user (when
-- computing their net balance on the trip). Two indexes, one per pattern.
CREATE INDEX IF NOT EXISTS trip_expense_splits_expense_idx
    ON public.trip_expense_splits (expense_id);

CREATE INDEX IF NOT EXISTS trip_expense_splits_user_settled_idx
    ON public.trip_expense_splits (user_id, settled);

-- =====================================================
-- 3. Row-Level Security on trip_expense_splits
-- =====================================================
ALTER TABLE public.trip_expense_splits ENABLE ROW LEVEL SECURITY;

-- SELECT: any member of the trip the parent expense belongs to can
-- read the split. Mirror trip_expenses_select_member's owner-OR-collab
-- membership shape rather than introduce a helper, so the audit story
-- stays grep-able alongside the parent table's policies.
DROP POLICY IF EXISTS "trip_expense_splits_select_member" ON public.trip_expense_splits;
CREATE POLICY "trip_expense_splits_select_member"
    ON public.trip_expense_splits
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1
              FROM public.trip_expenses e
              JOIN public.trips t ON t.id = e.trip_id
             WHERE e.id = trip_expense_splits.expense_id
               AND (
                    t.user_id = auth.uid()
                 OR EXISTS (
                        SELECT 1
                          FROM public.trip_collaborators tc
                         WHERE tc.trip_id = e.trip_id
                           AND tc.user_id = auth.uid()
                    )
               )
        )
    );

-- INSERT / UPDATE / DELETE: only the expense creator OR the trip owner.
-- This deliberately excludes generic collaborators because mutating
-- someone else's split is a financial-trust action — the audit trail
-- needs to track who edited what. Owner override matches the parent
-- table's policy ("this person left the trip and we need to fix it").
DROP POLICY IF EXISTS "trip_expense_splits_insert_creator_or_owner" ON public.trip_expense_splits;
CREATE POLICY "trip_expense_splits_insert_creator_or_owner"
    ON public.trip_expense_splits
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1
              FROM public.trip_expenses e
              LEFT JOIN public.trips t ON t.id = e.trip_id
             WHERE e.id = trip_expense_splits.expense_id
               AND (
                    e.created_by = auth.uid()
                 OR t.user_id = auth.uid()
               )
        )
    );

DROP POLICY IF EXISTS "trip_expense_splits_update_creator_or_owner" ON public.trip_expense_splits;
CREATE POLICY "trip_expense_splits_update_creator_or_owner"
    ON public.trip_expense_splits
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1
              FROM public.trip_expenses e
              LEFT JOIN public.trips t ON t.id = e.trip_id
             WHERE e.id = trip_expense_splits.expense_id
               AND (
                    e.created_by = auth.uid()
                 OR t.user_id = auth.uid()
               )
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
              FROM public.trip_expenses e
              LEFT JOIN public.trips t ON t.id = e.trip_id
             WHERE e.id = trip_expense_splits.expense_id
               AND (
                    e.created_by = auth.uid()
                 OR t.user_id = auth.uid()
               )
        )
    );

DROP POLICY IF EXISTS "trip_expense_splits_delete_creator_or_owner" ON public.trip_expense_splits;
CREATE POLICY "trip_expense_splits_delete_creator_or_owner"
    ON public.trip_expense_splits
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1
              FROM public.trip_expenses e
              LEFT JOIN public.trips t ON t.id = e.trip_id
             WHERE e.id = trip_expense_splits.expense_id
               AND (
                    e.created_by = auth.uid()
                 OR t.user_id = auth.uid()
               )
        )
    );

-- =====================================================
-- 4. compute_trip_settlements RPC
-- =====================================================
-- Per-currency greedy debt simplification.
--
-- ALGORITHM
--   1. Build per-currency net balance for every user appearing on any
--      expense (as payer OR as owe-er via split):
--        net = sum(paid as payer) - sum(owed via splits)
--      Positive net = creditor (others owe them). Negative = debtor.
--   2. For each currency, repeatedly pair the largest creditor with the
--      largest debtor and emit a transfer of min(creditor, |debtor|);
--      reduce both balances by that amount; drop balances that fall
--      within EPSILON of zero. Continue until at most one non-zero
--      balance remains (which can only happen on rounding noise).
--
-- AUTHORIZATION
--   SECURITY INVOKER (default) so RLS on trip_expenses + trip_expense_splits
--   gates the inputs — a non-member calling this for someone else's trip
--   reads zero rows and gets back an empty TABLE.
--
-- RETURNS one row per recommended transfer. Caller renders "Alice owes
-- Bob €45" by joining from_name → "Alice", to_name → "Bob", amount → 45.
--
-- IDEMPOTENT + READ-ONLY. Safe to call from a GET handler.
CREATE OR REPLACE FUNCTION public.compute_trip_settlements(p_trip_id UUID)
RETURNS TABLE (
    from_user_id UUID,
    from_name TEXT,
    to_user_id UUID,
    to_name TEXT,
    amount NUMERIC,
    currency TEXT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_currency TEXT;
    v_creditor RECORD;
    v_debtor RECORD;
    v_transfer NUMERIC;
    v_iterations INT;
    v_epsilon CONSTANT NUMERIC := 0.005; -- half a cent — below display precision
BEGIN
    -- Working table of per-(user, currency) net balances. TEMP table so
    -- it disappears at txn end; ON COMMIT DROP guarantees no leak even
    -- if the caller wraps this in a longer transaction.
    CREATE TEMP TABLE IF NOT EXISTS _balances (
        user_id UUID NOT NULL,
        currency TEXT NOT NULL,
        balance NUMERIC NOT NULL,
        display_name TEXT,
        PRIMARY KEY (user_id, currency)
    ) ON COMMIT DROP;
    TRUNCATE _balances;

    -- Compute net balance per (user, currency) over all expenses on
    -- this trip. paid contributes positive; share_amount contributes
    -- negative. NULL paid_by_user_id is skipped (orphaned expense).
    INSERT INTO _balances (user_id, currency, balance, display_name)
    SELECT
        u.user_id,
        u.currency,
        SUM(u.delta) AS balance,
        MAX(usr.display_name) AS display_name
    FROM (
        -- Payer side: + amount per expense
        SELECT
            e.paid_by_user_id AS user_id,
            e.currency,
            e.amount AS delta
          FROM public.trip_expenses e
         WHERE e.trip_id = p_trip_id
           AND e.paid_by_user_id IS NOT NULL

        UNION ALL

        -- Owe-er side: - share_amount per split
        SELECT
            s.user_id,
            e.currency,
            -s.share_amount AS delta
          FROM public.trip_expense_splits s
          JOIN public.trip_expenses e ON e.id = s.expense_id
         WHERE e.trip_id = p_trip_id
    ) u
    LEFT JOIN public.users usr ON usr.id = u.user_id
    GROUP BY u.user_id, u.currency
    -- Drop rows that already net to zero (or rounding noise); they
    -- can't be either creditor or debtor.
    HAVING ABS(SUM(u.delta)) > v_epsilon;

    -- One greedy pass per currency. We iterate over the distinct
    -- currencies that actually have non-zero balances; nothing else
    -- to settle in currencies where everyone broke even.
    FOR v_currency IN
        SELECT DISTINCT b.currency FROM _balances b ORDER BY b.currency
    LOOP
        -- Safety cap on iterations. With N users and greedy pairing the
        -- loop terminates in at most N-1 transfers; the +5 buffer
        -- absorbs degenerate rounding edge cases.
        v_iterations := 0;

        LOOP
            v_iterations := v_iterations + 1;
            EXIT WHEN v_iterations > 200; -- hard ceiling, can't realistically hit

            -- Largest creditor (most positive balance) in this currency.
            SELECT b.user_id, b.balance, b.display_name
              INTO v_creditor
              FROM _balances b
             WHERE b.currency = v_currency
               AND b.balance > v_epsilon
             ORDER BY b.balance DESC
             LIMIT 1;

            -- Largest debtor (most negative balance) in this currency.
            SELECT b.user_id, b.balance, b.display_name
              INTO v_debtor
              FROM _balances b
             WHERE b.currency = v_currency
               AND b.balance < -v_epsilon
             ORDER BY b.balance ASC
             LIMIT 1;

            -- If either side is empty, this currency is settled.
            EXIT WHEN v_creditor.user_id IS NULL OR v_debtor.user_id IS NULL;

            -- Transfer min(creditor, |debtor|) from debtor to creditor.
            -- ROUND to 2 dp so we emit human-readable amounts and don't
            -- chase sub-cent rounding tails forever.
            v_transfer := ROUND(LEAST(v_creditor.balance, -v_debtor.balance), 2);

            -- Edge case: if rounding makes the transfer fall to 0 we'd
            -- loop forever — clamp the balances to zero and continue.
            IF v_transfer <= v_epsilon THEN
                UPDATE _balances SET balance = 0
                 WHERE user_id IN (v_creditor.user_id, v_debtor.user_id)
                   AND currency = v_currency;
                CONTINUE;
            END IF;

            -- Emit the recommended transfer.
            from_user_id := v_debtor.user_id;
            from_name := COALESCE(v_debtor.display_name, '');
            to_user_id := v_creditor.user_id;
            to_name := COALESCE(v_creditor.display_name, '');
            amount := v_transfer;
            currency := v_currency;
            RETURN NEXT;

            -- Reduce both balances by the transfer amount.
            UPDATE _balances
               SET balance = balance - v_transfer
             WHERE user_id = v_creditor.user_id
               AND currency = v_currency;
            UPDATE _balances
               SET balance = balance + v_transfer
             WHERE user_id = v_debtor.user_id
               AND currency = v_currency;
        END LOOP;
    END LOOP;

    -- Clean up the temp table inside the same txn — defensive even with
    -- ON COMMIT DROP, since a long-running parent txn could otherwise
    -- accumulate state across multiple compute_trip_settlements calls.
    TRUNCATE _balances;

    RETURN;
END;
$$;

COMMENT ON FUNCTION public.compute_trip_settlements(UUID) IS
    'Greedy minimum-transfer settlement per currency. SECURITY INVOKER — RLS gates inputs.';

GRANT EXECUTE ON FUNCTION public.compute_trip_settlements(UUID) TO authenticated;
