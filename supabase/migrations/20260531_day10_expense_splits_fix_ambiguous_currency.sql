-- Day-10 P0 follow-up: fix `42702 column reference "currency" is ambiguous`
-- in compute_trip_settlements. The OUT parameter `currency` (defined in the
-- RETURNS TABLE clause) shadows the _balances.currency column inside the
-- function body, so every bare `currency = v_currency` predicate becomes
-- ambiguous and PG refuses to plan it.
--
-- Root cause caught by the Day-10 adversarial verifier on a synthetic
-- €90÷3 settlement: empty/balanced trips never reach the inner UPDATE so
-- the bug stayed latent; any trip with an actual non-zero balance threw.
--
-- Fix: alias _balances as `b` everywhere inside the function body and
-- qualify the column refs (`b.currency = v_currency`). API contract is
-- unchanged — same parameter list, same RETURNS TABLE shape, same
-- security invoker semantics. Route handler and UI need no changes.

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
    HAVING ABS(SUM(u.delta)) > v_epsilon;

    -- One greedy pass per currency. Iterating only over currencies that
    -- actually have non-zero balances.
    FOR v_currency IN
        SELECT DISTINCT b.currency FROM _balances b ORDER BY b.currency
    LOOP
        v_iterations := 0;

        LOOP
            v_iterations := v_iterations + 1;
            EXIT WHEN v_iterations > 200; -- hard ceiling

            -- Largest creditor in this currency. Alias the table as b so
            -- the bare `currency` predicate cannot collide with the OUT
            -- parameter of the same name.
            SELECT b.user_id, b.balance, b.display_name
              INTO v_creditor
              FROM _balances b
             WHERE b.currency = v_currency
               AND b.balance > v_epsilon
             ORDER BY b.balance DESC
             LIMIT 1;

            -- Largest debtor in this currency.
            SELECT b.user_id, b.balance, b.display_name
              INTO v_debtor
              FROM _balances b
             WHERE b.currency = v_currency
               AND b.balance < -v_epsilon
             ORDER BY b.balance ASC
             LIMIT 1;

            EXIT WHEN v_creditor.user_id IS NULL OR v_debtor.user_id IS NULL;

            v_transfer := ROUND(LEAST(v_creditor.balance, -v_debtor.balance), 2);

            -- Rounding edge case: clamp both sides to 0 and continue.
            -- Qualify _balances.currency via the b alias to avoid ambiguity
            -- with the OUT parameter `currency`.
            IF v_transfer <= v_epsilon THEN
                UPDATE _balances AS b
                   SET balance = 0
                 WHERE b.user_id IN (v_creditor.user_id, v_debtor.user_id)
                   AND b.currency = v_currency;
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

            -- Reduce both balances by the transfer amount. Same alias
            -- trick to dodge the OUT-param shadow.
            UPDATE _balances AS b
               SET balance = b.balance - v_transfer
             WHERE b.user_id = v_creditor.user_id
               AND b.currency = v_currency;
            UPDATE _balances AS b
               SET balance = b.balance + v_transfer
             WHERE b.user_id = v_debtor.user_id
               AND b.currency = v_currency;
        END LOOP;
    END LOOP;

    TRUNCATE _balances;

    RETURN;
END;
$$;

COMMENT ON FUNCTION public.compute_trip_settlements(UUID) IS
    'Greedy minimum-transfer settlement per currency. SECURITY INVOKER — RLS gates inputs. Aliased _balances refs to dodge OUT-param shadow on `currency`.';

GRANT EXECUTE ON FUNCTION public.compute_trip_settlements(UUID) TO authenticated;
