-- compute_trip_settlements: read names from public_profiles, not public.users.
--
-- This function is SECURITY INVOKER and is called with the caller's cookie
-- client (app/api/trips/[id]/settlements, components/trip/SettleUpView). It
-- joins public.users purely to decorate each balance with a display_name.
--
-- Once public.users is restricted to the row owner (20260820210000), that join
-- matches only the caller. And because it is a LEFT JOIN, nothing errors and no
-- balance changes — every other member's display_name simply becomes NULL, and
-- the COALESCE below turns it into ''. Settle Up would render correct amounts
-- with blank names on both sides of every transfer: "  owes   EUR 40.00".
--
-- public_profiles is a security_invoker=false view, so it returns names to any
-- caller. Names are the only thing taken from it, which is exactly what that
-- view exists to expose.
--
-- Body is otherwise byte-identical to the existing definition; the single
-- change is the join source.

CREATE OR REPLACE FUNCTION public.compute_trip_settlements(p_trip_id uuid)
 RETURNS TABLE(from_user_id uuid, from_name text, to_user_id uuid, to_name text, amount numeric, currency text)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
    v_currency TEXT;
    v_creditor RECORD;
    v_debtor RECORD;
    v_transfer NUMERIC;
    v_iterations INT;
    v_epsilon CONSTANT NUMERIC := 0.005;
BEGIN
    CREATE TEMP TABLE IF NOT EXISTS _balances (
        user_id UUID NOT NULL,
        currency TEXT NOT NULL,
        balance NUMERIC NOT NULL,
        display_name TEXT,
        PRIMARY KEY (user_id, currency)
    ) ON COMMIT DROP;
    TRUNCATE _balances;

    INSERT INTO _balances (user_id, currency, balance, display_name)
    SELECT
        u.user_id,
        u.currency,
        SUM(u.delta) AS balance,
        MAX(usr.display_name) AS display_name
    FROM (
        SELECT
            e.paid_by_user_id AS user_id,
            e.currency,
            e.amount AS delta
          FROM public.trip_expenses e
         WHERE e.trip_id = p_trip_id
           AND e.paid_by_user_id IS NOT NULL
        UNION ALL
        SELECT
            s.user_id,
            e.currency,
            -s.share_amount AS delta
          FROM public.trip_expense_splits s
          JOIN public.trip_expenses e ON e.id = s.expense_id
         WHERE e.trip_id = p_trip_id
    ) u
    LEFT JOIN public.public_profiles usr ON usr.id = u.user_id
    GROUP BY u.user_id, u.currency
    HAVING ABS(SUM(u.delta)) > v_epsilon;

    FOR v_currency IN
        SELECT DISTINCT b.currency FROM _balances b ORDER BY b.currency
    LOOP
        v_iterations := 0;

        LOOP
            v_iterations := v_iterations + 1;
            EXIT WHEN v_iterations > 200;

            SELECT b.user_id, b.balance, b.display_name
              INTO v_creditor
              FROM _balances b
             WHERE b.currency = v_currency
               AND b.balance > v_epsilon
             ORDER BY b.balance DESC
             LIMIT 1;

            SELECT b.user_id, b.balance, b.display_name
              INTO v_debtor
              FROM _balances b
             WHERE b.currency = v_currency
               AND b.balance < -v_epsilon
             ORDER BY b.balance ASC
             LIMIT 1;

            EXIT WHEN v_creditor.user_id IS NULL OR v_debtor.user_id IS NULL;

            v_transfer := ROUND(LEAST(v_creditor.balance, -v_debtor.balance), 2);

            IF v_transfer <= v_epsilon THEN
                UPDATE _balances AS b
                   SET balance = 0
                 WHERE b.user_id IN (v_creditor.user_id, v_debtor.user_id)
                   AND b.currency = v_currency;
                CONTINUE;
            END IF;

            from_user_id := v_debtor.user_id;
            from_name := COALESCE(v_debtor.display_name, '');
            to_user_id := v_creditor.user_id;
            to_name := COALESCE(v_creditor.display_name, '');
            amount := v_transfer;
            currency := v_currency;
            RETURN NEXT;

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
$function$;
