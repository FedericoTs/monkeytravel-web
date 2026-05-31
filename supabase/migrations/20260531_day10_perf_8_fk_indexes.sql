-- Day-10 perf advisor sweep — Task A: add 8 missing FK indexes.
-- Source: Supabase performance advisor, 8 `unindexed_foreign_keys` findings.
--
-- Without these, every cascade-delete on the parent table triggers a
-- sequential scan of the child table to find rows to cascade.
-- Joins on the FK column also seq-scan. Cheap to add (single-column
-- btree, small tables, write-light), large payoff on hot paths:
--   - trip cascade deletes (clears reports + expenses)
--   - notification bell read by user_id
--   - wizard funnel queries by user_id (Task #285 follow-up)

CREATE INDEX IF NOT EXISTS idx_hostelworld_clicks_user_id
  ON public.hostelworld_clicks(user_id);

CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_user_id
  ON public.scheduled_notifications(user_id);

CREATE INDEX IF NOT EXISTS idx_trip_expenses_created_by
  ON public.trip_expenses(created_by);

CREATE INDEX IF NOT EXISTS idx_trip_expenses_paid_by_user_id
  ON public.trip_expenses(paid_by_user_id);

CREATE INDEX IF NOT EXISTS idx_trip_reports_reporter_user_id
  ON public.trip_reports(reporter_user_id);

CREATE INDEX IF NOT EXISTS idx_trip_reports_resolved_by
  ON public.trip_reports(resolved_by);

CREATE INDEX IF NOT EXISTS idx_trip_reports_trip_id
  ON public.trip_reports(trip_id);

CREATE INDEX IF NOT EXISTS idx_wizard_step_events_user_id
  ON public.wizard_step_events(user_id);
