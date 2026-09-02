-- A suppressed notification row must never permanently block re-enqueue.
--
-- enqueue_trip_notifications re-queues a trip's pre-trip cascade whenever its
-- dates change. It did:
--
--     DELETE ... WHERE trip_id = $1 AND status = 'pending';
--     INSERT ... ON CONFLICT (trip_id, slot) DO NOTHING;
--
-- The DELETE clears only *pending* rows, while the unique index
-- scheduled_notifications_trip_id_slot_key covers EVERY status. So any
-- suppressed row keeps occupying (trip_id, slot): the INSERT hits the
-- conflict, DO NOTHING fires, and that trip silently gets no cascade — for as
-- long as the row exists. Editing the trip, forking it, or moving its dates
-- all fail identically and silently.
--
-- Found via the 2026-08-27 manual hold, which suppressed 670 rows and could
-- not be undone by any product action: every pre-trip slot showed ~46-57 held
-- users, and every genuinely pending row had been created on or after
-- 2026-08-28 — only trips created AFTER the hold had a cascade at all.
--
-- The guard `WHERE ... status = 'suppressed'` is the load-bearing half. A row
-- already 'sent' must fall through untouched, or a date change would mail the
-- same reminder twice. Pending rows were deleted one statement earlier, so
-- 'suppressed' is the only revivable state.
--
-- Keeping the index non-partial (rather than the alternative fix of making it
-- partial on status) means ON CONFLICT inference still works and the conflict
-- target does not have to change.

CREATE OR REPLACE FUNCTION public.enqueue_trip_notifications(p_trip_id uuid, p_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  SLOT_HOUR CONSTANT INTERVAL := INTERVAL '6 hours';
  v_start     TIMESTAMPTZ;
  v_muted     BOOLEAN;
  v_cancelled BOOLEAN;
  v_count     INT := 0;
BEGIN
  SELECT
    start_date::timestamptz + SLOT_HOUR,
    COALESCE(reminders_muted, FALSE),
    status = 'cancelled'
  INTO v_start, v_muted, v_cancelled
  FROM trips
  WHERE id = p_trip_id AND user_id = p_user_id;

  IF v_start IS NULL OR v_muted OR COALESCE(v_cancelled, FALSE) OR v_start < NOW() THEN
    DELETE FROM scheduled_notifications
     WHERE trip_id = p_trip_id AND status = 'pending';
    RETURN 0;
  END IF;

  DELETE FROM scheduled_notifications
   WHERE trip_id = p_trip_id AND status = 'pending';

  INSERT INTO scheduled_notifications (user_id, trip_id, slot, scheduled_for)
  SELECT p_user_id, p_trip_id, slot, v_start - offset_intv
  FROM (VALUES
    ('pack_early_14d', INTERVAL '14 days'),
    ('visa_check_7d',  INTERVAL '7 days'),
    ('weather_3d',     INTERVAL '3 days'),
    ('confirm_1d',     INTERVAL '1 day'),
    ('morning_of',     INTERVAL '0')
  ) AS s(slot, offset_intv)
  WHERE v_start - offset_intv > NOW()
  ON CONFLICT (trip_id, slot) DO UPDATE
     SET scheduled_for  = EXCLUDED.scheduled_for,
         user_id        = EXCLUDED.user_id,
         status         = 'pending',
         skipped_reason = NULL,
         last_error     = NULL,
         updated_at     = NOW()
   WHERE scheduled_notifications.status = 'suppressed';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;
