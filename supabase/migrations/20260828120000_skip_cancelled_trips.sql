-- A cancelled trip must never generate email.
--
-- WHAT WAS WRONG
-- --------------
-- Neither enqueue RPC consulted trips.status, and neither did the dispatching
-- cron — it re-checked reminders_muted but nothing else. So a user could
-- explicitly cancel a trip and still receive the full countdown to it.
--
-- Measured on the live queue 2026-08-28, with the cascade held pending review:
--
--   Palermo, Agrigento, Syracuse & Taormina   cancelled 27 Jul   starts 01 Sep   3 rows
--   Pigeon Forge                              cancelled 25 Aug   starts 24 Sep   5 rows
--   Oslo                                      cancelled 23 Jun   starts 14 Oct   5 rows
--   Kruger National Park                      cancelled 16 Aug   starts Jun 2027 5 rows
--   Czech Republic, Austria, Slovakia & Hungary cancelled 23 Jul starts Dec 2027 5 rows
--
-- 23 scheduled rows across 5 trips, every one with a future start date and
-- not one of them muted. The Sicily trip would have sent "Three days to
-- Palermo" on 29 August, a month after its owner cancelled it.
--
-- WHY BOTH LAYERS
-- ---------------
-- Enqueue alone is not enough: cancelling happens AFTER the trip was created
-- and its cascade queued, which is exactly how those 23 rows came to exist.
-- The cron therefore re-checks status at dispatch, the same way it re-checks
-- reminders_muted. This migration closes the other half so new cancellations
-- also stop producing rows, and an existing cancellation clears its pending
-- rows the next time anything re-enqueues that trip.
--
-- WHY ONLY 'cancelled'
-- --------------------
-- The CHECK allows planning / confirmed / cancelled. It is tempting to send
-- only for 'confirmed', but 'planning' is the DEFAULT and describes 302 of
-- 394 live trips — it means nobody touched a control most users never see,
-- not that the trip is imaginary. Restricting to 'confirmed' would silence
-- roughly 84% of legitimate reminders. Only 'cancelled' is an explicit
-- statement by the user that the trip is not happening, so only 'cancelled'
-- stops the mail.

CREATE OR REPLACE FUNCTION public.enqueue_trip_notifications(
  p_trip_id UUID,
  p_user_id UUID
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  -- Must stay strictly BELOW the cron hour (07:00 UTC) or every slot slips a
  -- full day. See 20260827120000.
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
  ON CONFLICT (trip_id, slot) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.enqueue_trip_followups(
  p_trip_id UUID,
  p_user_id UUID
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  SLOT_HOUR CONSTANT INTERVAL := INTERVAL '6 hours';
  v_end       TIMESTAMPTZ;
  v_muted     BOOLEAN;
  v_cancelled BOOLEAN;
  v_count     INT := 0;
BEGIN
  SELECT
    end_date::timestamptz + SLOT_HOUR,
    COALESCE(reminders_muted, FALSE),
    status = 'cancelled'
  INTO v_end, v_muted, v_cancelled
  FROM trips
  WHERE id = p_trip_id AND user_id = p_user_id AND deleted_at IS NULL;

  -- "How was your trip?" is worse than a countdown for a cancelled trip,
  -- because it asserts the trip happened.
  IF v_end IS NULL OR v_muted OR COALESCE(v_cancelled, FALSE) THEN
    DELETE FROM scheduled_notifications
     WHERE trip_id = p_trip_id AND status = 'pending' AND slot LIKE 'followup_%';
    RETURN 0;
  END IF;

  DELETE FROM scheduled_notifications
   WHERE trip_id = p_trip_id AND status = 'pending' AND slot LIKE 'followup_%';

  INSERT INTO scheduled_notifications (user_id, trip_id, slot, scheduled_for)
  SELECT p_user_id, p_trip_id, slot, v_end + offset_intv
  FROM (VALUES
    ('followup_return_3d', INTERVAL '3 days'),
    ('followup_next_21d',  INTERVAL '21 days'),
    ('followup_final_45d', INTERVAL '45 days')
  ) AS s(slot, offset_intv)
  WHERE v_end + offset_intv > NOW()
  ON CONFLICT (trip_id, slot) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$fn$;

COMMENT ON FUNCTION public.enqueue_trip_notifications(UUID, UUID) IS
  'Idempotent enqueue of the 5-slot pre-trip cascade. Slots land at 06:00 UTC so the 07:00 cron catches them the same day. Returns rows inserted; 0 if muted, CANCELLED, no start_date, or start in the past.';

COMMENT ON FUNCTION public.enqueue_trip_followups(UUID, UUID) IS
  'Idempotent enqueue of the 3-slot post-trip sequence, offset from end_date on the same 06:00 UTC grid. Marketing, not transactional. Returns 0 if muted, CANCELLED, or no end_date.';

-- Clear the rows that should never have been queued. Marked rather than
-- deleted so the decision stays auditable, and using the same vocabulary the
-- cron now writes.
UPDATE public.scheduled_notifications s
   SET status = 'suppressed',
       skipped_reason = 'trip_cancelled',
       updated_at = NOW()
  FROM public.trips t
 WHERE t.id = s.trip_id
   AND t.status = 'cancelled'
   AND s.status IN ('pending', 'suppressed')
   AND COALESCE(s.skipped_reason, '') <> 'trip_cancelled';
