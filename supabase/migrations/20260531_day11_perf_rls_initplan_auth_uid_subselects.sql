-- =====================================================================
-- Day-11 Performance: Wrap bare auth.uid() / auth.jwt() in (select ...)
-- =====================================================================
-- Addresses Supabase performance advisor lint: auth_rls_initplan
--   ("Auth RLS Initialization Plan", 0003_auth_rls_initplan)
-- https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select
--
-- Problem: When auth.uid() (or auth.jwt(), current_setting()) is called
-- bare inside an RLS USING / WITH CHECK clause, Postgres re-evaluates it
-- once per row scanned. Wrapping it as `(select auth.uid())` lets the
-- planner cache the result in an InitPlan, evaluated exactly once per
-- query. Semantically identical, but O(n) -> O(1) on the auth function
-- evaluation.
--
-- Scope: 26 policies across 12 public tables, all flagged by the
-- advisor on 2026-05-31. Every DROP+CREATE pair below preserves the
-- ORIGINAL policy semantics exactly -- only bare auth.uid()/auth.jwt()
-- call sites are wrapped in (select ...). Roles, cmd, USING clause
-- shape, WITH CHECK clause shape, joined subqueries, and all literal
-- predicates are unchanged.
--
-- Idempotent: every DROP uses IF EXISTS so reruns are safe.
-- Grouped by table for review.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- public.device_tokens (3 policies)
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "users delete own device_tokens" ON public.device_tokens;
CREATE POLICY "users delete own device_tokens" ON public.device_tokens
  FOR DELETE
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "users insert own device_tokens" ON public.device_tokens;
CREATE POLICY "users insert own device_tokens" ON public.device_tokens
  FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "users read own device_tokens" ON public.device_tokens;
CREATE POLICY "users read own device_tokens" ON public.device_tokens
  FOR SELECT
  USING ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------
-- public.email_log (1 policy)
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS email_log_select_own ON public.email_log;
CREATE POLICY email_log_select_own ON public.email_log
  FOR SELECT
  USING (
    recipient_email = (
      SELECT users.email
        FROM auth.users
       WHERE users.id = (select auth.uid())
    )::text
  );

-- ---------------------------------------------------------------------
-- public.notifications (2 policies)
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS notifications_select_own ON public.notifications;
CREATE POLICY notifications_select_own ON public.notifications
  FOR SELECT
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS notifications_update_own ON public.notifications;
CREATE POLICY notifications_update_own ON public.notifications
  FOR UPDATE
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------
-- public.push_log (1 policy)
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "users read own push_log" ON public.push_log;
CREATE POLICY "users read own push_log" ON public.push_log
  FOR SELECT
  USING ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------
-- public.scheduled_notifications (1 policy)
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS sn_select_own ON public.scheduled_notifications;
CREATE POLICY sn_select_own ON public.scheduled_notifications
  FOR SELECT
  USING ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------
-- public.trip_calendar_syncs (1 policy)
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS tcs_select_owner_or_collab ON public.trip_calendar_syncs;
CREATE POLICY tcs_select_owner_or_collab ON public.trip_calendar_syncs
  FOR SELECT
  USING (
    (
      EXISTS (
        SELECT 1
          FROM trips t
         WHERE t.id = trip_calendar_syncs.trip_id
           AND t.user_id = (select auth.uid())
      )
    )
    OR
    (
      EXISTS (
        SELECT 1
          FROM trip_collaborators tc
         WHERE tc.trip_id = trip_calendar_syncs.trip_id
           AND tc.user_id = (select auth.uid())
      )
    )
  );

-- ---------------------------------------------------------------------
-- public.trip_expense_splits (4 policies)
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS trip_expense_splits_delete_creator_or_owner ON public.trip_expense_splits;
CREATE POLICY trip_expense_splits_delete_creator_or_owner ON public.trip_expense_splits
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1
        FROM trip_expenses e
        LEFT JOIN trips t ON t.id = e.trip_id
       WHERE e.id = trip_expense_splits.expense_id
         AND (
           e.created_by = (select auth.uid())
           OR t.user_id = (select auth.uid())
         )
    )
  );

DROP POLICY IF EXISTS trip_expense_splits_insert_creator_or_owner ON public.trip_expense_splits;
CREATE POLICY trip_expense_splits_insert_creator_or_owner ON public.trip_expense_splits
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM trip_expenses e
        LEFT JOIN trips t ON t.id = e.trip_id
       WHERE e.id = trip_expense_splits.expense_id
         AND (
           e.created_by = (select auth.uid())
           OR t.user_id = (select auth.uid())
         )
    )
  );

DROP POLICY IF EXISTS trip_expense_splits_select_member ON public.trip_expense_splits;
CREATE POLICY trip_expense_splits_select_member ON public.trip_expense_splits
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
        FROM trip_expenses e
        JOIN trips t ON t.id = e.trip_id
       WHERE e.id = trip_expense_splits.expense_id
         AND (
           t.user_id = (select auth.uid())
           OR EXISTS (
             SELECT 1
               FROM trip_collaborators tc
              WHERE tc.trip_id = e.trip_id
                AND tc.user_id = (select auth.uid())
           )
         )
    )
  );

DROP POLICY IF EXISTS trip_expense_splits_update_creator_or_owner ON public.trip_expense_splits;
CREATE POLICY trip_expense_splits_update_creator_or_owner ON public.trip_expense_splits
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
        FROM trip_expenses e
        LEFT JOIN trips t ON t.id = e.trip_id
       WHERE e.id = trip_expense_splits.expense_id
         AND (
           e.created_by = (select auth.uid())
           OR t.user_id = (select auth.uid())
         )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM trip_expenses e
        LEFT JOIN trips t ON t.id = e.trip_id
       WHERE e.id = trip_expense_splits.expense_id
         AND (
           e.created_by = (select auth.uid())
           OR t.user_id = (select auth.uid())
         )
    )
  );

-- ---------------------------------------------------------------------
-- public.trip_expenses (4 policies)
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS trip_expenses_delete_creator_or_owner ON public.trip_expenses;
CREATE POLICY trip_expenses_delete_creator_or_owner ON public.trip_expenses
  FOR DELETE
  USING (
    (select auth.uid()) = created_by
    OR EXISTS (
      SELECT 1
        FROM trips t
       WHERE t.id = trip_expenses.trip_id
         AND t.user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS trip_expenses_insert_member ON public.trip_expenses;
CREATE POLICY trip_expenses_insert_member ON public.trip_expenses
  FOR INSERT
  WITH CHECK (
    (select auth.uid()) = created_by
    AND (
      EXISTS (
        SELECT 1
          FROM trips t
         WHERE t.id = trip_expenses.trip_id
           AND t.user_id = (select auth.uid())
      )
      OR EXISTS (
        SELECT 1
          FROM trip_collaborators tc
         WHERE tc.trip_id = trip_expenses.trip_id
           AND tc.user_id = (select auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS trip_expenses_select_member ON public.trip_expenses;
CREATE POLICY trip_expenses_select_member ON public.trip_expenses
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
        FROM trips t
       WHERE t.id = trip_expenses.trip_id
         AND t.user_id = (select auth.uid())
    )
    OR EXISTS (
      SELECT 1
        FROM trip_collaborators tc
       WHERE tc.trip_id = trip_expenses.trip_id
         AND tc.user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS trip_expenses_update_creator_or_owner ON public.trip_expenses;
CREATE POLICY trip_expenses_update_creator_or_owner ON public.trip_expenses
  FOR UPDATE
  USING (
    (select auth.uid()) = created_by
    OR EXISTS (
      SELECT 1
        FROM trips t
       WHERE t.id = trip_expenses.trip_id
         AND t.user_id = (select auth.uid())
    )
  )
  WITH CHECK (
    (select auth.uid()) = created_by
    OR EXISTS (
      SELECT 1
        FROM trips t
       WHERE t.id = trip_expenses.trip_id
         AND t.user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------
-- public.trip_likes (3 policies)
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS trip_likes_public_read ON public.trip_likes;
CREATE POLICY trip_likes_public_read ON public.trip_likes
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
        FROM trips t
       WHERE t.id = trip_likes.trip_id
         AND t.visibility = 'public'::text
         AND t.is_hidden = false
    )
    OR (
      (select auth.uid()) IS NOT NULL
      AND user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS trip_likes_self_delete ON public.trip_likes;
CREATE POLICY trip_likes_self_delete ON public.trip_likes
  FOR DELETE
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS trip_likes_self_insert ON public.trip_likes;
CREATE POLICY trip_likes_self_insert ON public.trip_likes
  FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------
-- public.trip_saves (3 policies)
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS trip_saves_self_delete ON public.trip_saves;
CREATE POLICY trip_saves_self_delete ON public.trip_saves
  FOR DELETE
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS trip_saves_self_insert ON public.trip_saves;
CREATE POLICY trip_saves_self_insert ON public.trip_saves
  FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS trip_saves_self_read ON public.trip_saves;
CREATE POLICY trip_saves_self_read ON public.trip_saves
  FOR SELECT
  USING ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------
-- public.user_calendar_connections (1 policy)
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS ucc_select_own ON public.user_calendar_connections;
CREATE POLICY ucc_select_own ON public.user_calendar_connections
  FOR SELECT
  USING ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------
-- public.wizard_step_events (2 policies)
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS wizard_step_events_insert_self ON public.wizard_step_events;
CREATE POLICY wizard_step_events_insert_self ON public.wizard_step_events
  FOR INSERT
  WITH CHECK (
    user_id IS NULL
    OR user_id = (select auth.uid())
  );

DROP POLICY IF EXISTS wizard_step_events_select_admin ON public.wizard_step_events;
CREATE POLICY wizard_step_events_select_admin ON public.wizard_step_events
  FOR SELECT
  USING (
    ((select auth.jwt()) ->> 'email'::text) = ANY (
      ARRAY[
        'federicosciuca@gmail.com'::text,
        'azzolina.francesca@gmail.com'::text,
        'marinoenrico3@gmail.com'::text
      ]
    )
  );

COMMIT;

-- =====================================================================
-- Verification (informational -- run after apply):
--
--   SELECT tablename, policyname, qual, with_check
--     FROM pg_policies
--    WHERE schemaname = 'public'
--      AND (qual ~ '\\mauth\\.(uid|jwt|role|email)\\s*\\(\\s*\\)'
--        OR with_check ~ '\\mauth\\.(uid|jwt|role|email)\\s*\\(\\s*\\)')
--      AND tablename IN (
--        'device_tokens','email_log','notifications','push_log',
--        'scheduled_notifications','trip_calendar_syncs',
--        'trip_expense_splits','trip_expenses','trip_likes','trip_saves',
--        'user_calendar_connections','wizard_step_events'
--      );
--
-- Expected: 0 rows. (Postgres stores `(select auth.uid())` as
-- `( SELECT auth.uid() AS uid)`, which the bare-call regex above
-- will not match.)
-- =====================================================================
