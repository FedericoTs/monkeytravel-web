-- Live Trip plan, Phase 3.4 (expenses half) — split "Who paid?" across the
-- trip's PARTICIPANTS, who are anonymous (Phase 2), not just authenticated
-- collaborators.
--
-- trip_expenses / trip_expense_splits were built authed-only
-- (created_by / paid_by_user_id / splits.user_id all reference auth.users) and
-- are currently DORMANT — no app code writes splits; the live ExpenseLedger
-- reads trip_expenses only. So extending them for anonymous actors is low-risk,
-- with ONE thing to protect: the authed Settle Up (compute_trip_settlements),
-- which must keep computing over authenticated identities only. The single
-- functional change to the RPC below is `AND s.user_id IS NOT NULL`, so
-- anonymous splits never enter its user_id-keyed balances (its _balances PK is
-- NOT NULL, so without this an anon split would error the whole settlement).
--
-- The live-trip expense summary is computed in the /shared route (TS), over
-- authed AND anonymous splitters; it does not use this RPC.
--
-- RLS is left member-only on both tables: the shared surface writes and reads
-- through the service role (app/api/shared/[token]/expense[s]), same as the
-- chips. Additive and idempotent.

-- 1. trip_expenses: allow an anonymous creator / payer, and link an expense to
--    the Today activity it was logged on ("Who paid?" is per-activity).
alter table public.trip_expenses
  add column if not exists created_by_cookie_id text,
  add column if not exists created_by_name text,
  add column if not exists paid_by_cookie_id text,
  add column if not exists paid_by_name text,
  add column if not exists activity_id text;

comment on column public.trip_expenses.paid_by_cookie_id is
  'Anonymous payer (mt_anon_voter cookie) when paid_by_user_id is null — a participant paid. Live Trip Phase 3.4.';

-- 2. trip_expense_splits: the split target may be an anonymous participant.
alter table public.trip_expense_splits
  alter column user_id drop not null,
  add column if not exists participant_cookie_id text,
  add column if not exists participant_name text;

-- Exactly one identity per split row (authed user XOR anonymous participant).
alter table public.trip_expense_splits
  drop constraint if exists trip_expense_splits_identity_check;
alter table public.trip_expense_splits
  add constraint trip_expense_splits_identity_check
  check ((user_id is not null) <> (participant_cookie_id is not null));

-- The old UNIQUE(expense_id, user_id) can't express the anonymous case; replace
-- it with one that keys on whichever identity the row carries.
alter table public.trip_expense_splits
  drop constraint if exists trip_expense_splits_expense_id_user_id_key;
create unique index if not exists uniq_trip_expense_splits_actor
  on public.trip_expense_splits (expense_id, coalesce(user_id::text, participant_cookie_id));

comment on column public.trip_expense_splits.participant_cookie_id is
  'Anonymous splitter (mt_anon_voter cookie) when user_id is null. Excluded from compute_trip_settlements (authed-only). Live Trip Phase 3.4.';

-- 3. Guard the authed settlement. An expense that touches the anonymous /
--    live-trip world (any split with user_id IS NULL) is EXCLUDED wholesale:
--    including only its authed rows would unbalance the authed ledger (an anon
--    payer's payment is invisible, so an authed splitter on that expense would
--    show a phantom debt; an authed payer with anon splitters, a phantom
--    credit). Live-trip expenses always split across participants, so they
--    never enter authed Settle Up — which therefore behaves exactly as before
--    this migration. Only fully-authed expenses (the existing ExpenseLedger
--    path) settle here. Body is otherwise byte-identical to 20260820205000.
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
           AND NOT EXISTS (
             SELECT 1 FROM public.trip_expense_splits x
              WHERE x.expense_id = e.id AND x.user_id IS NULL
           )
        UNION ALL
        SELECT
            s.user_id,
            e.currency,
            -s.share_amount AS delta
          FROM public.trip_expense_splits s
          JOIN public.trip_expenses e ON e.id = s.expense_id
         WHERE e.trip_id = p_trip_id
           AND s.user_id IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM public.trip_expense_splits x
              WHERE x.expense_id = e.id AND x.user_id IS NULL
           )
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
