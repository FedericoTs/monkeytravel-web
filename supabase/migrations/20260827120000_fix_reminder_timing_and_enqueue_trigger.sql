-- Two defects that between them made the pre-trip cascade almost inert.
--
-- DEFECT 1 — every reminder landed a day late
-- -------------------------------------------
-- Slots were scheduled at start_date 09:00 UTC (`+ INTERVAL '9 hours'`).
-- The dispatching cron runs ONCE daily at 07:00 UTC (vercel.json
-- "0 7 * * *"). Its due-predicate is `scheduled_for <= NOW()`, so a slot
-- stamped 09:00 is never due at the 07:00 run on its own day — it waits
-- for the NEXT day's run, ~22h later.
--
-- Measured on the live queue before this migration: 10 of 10 sent rows
-- had sent_at::date - scheduled_for::date = 1. Not a sample — every
-- single row that has ever gone out.
--
-- The user-visible consequence is worst for `morning_of`, which is
-- scheduled for 09:00 on the departure date and therefore arrived the
-- morning AFTER the traveller left. `confirm_1d` ("Tomorrow — final
-- checks") arrived on the day of departure.
--
-- Fix: move slots to 06:00 UTC, an hour BEFORE the cron. Every slot is
-- then picked up by the same day's run. Chosen over changing the cron
-- schedule because the route's own docstring claims a 15-minute cadence
-- it does not have; aligning the data to the real schedule is the
-- smaller, verifiable change. (If the cron ever moves earlier than
-- 06:00 UTC this constant must move with it — hence SLOT_HOUR below is
-- stated once, not sprinkled.)
--
-- DEFECT 2 — the wizard never enqueued anything
-- ---------------------------------------------
-- lib/notifications/scheduling.ts opens with a browser guard:
--
--     if (typeof window !== "undefined") return { ok: true, ... };
--
-- added to stop createAdminClient() throwing in the browser (Sentry
-- JAVASCRIPT-NEXTJS-11). Its comment asserts "authenticated saves go
-- through API routes server-side and re-trigger this path". That is not
-- true. lib/trips/persistTrip.ts is imported by exactly one module —
-- app/[locale]/trips/new/NewTripWizard.tsx, a client component — and it
-- writes via the insert_trip_dedup RPC straight from the browser. So the
-- primary trip-creation path hit the guard and returned "disabled"
-- every time, silently.
--
-- Evidence: 164 upcoming trips exist; 12 trips have EVER had a queue
-- row, and those came from the genuine server routes (PATCH
-- /api/trips/[id], fork, duplicate). 146 upcoming trips have none.
--
-- Fix: enqueue from an AFTER INSERT trigger on trips. A trigger cannot
-- be bypassed by a client-side caller, needs no round-trip, and covers
-- every present and future insert path. Deliberately NOT folded into
-- insert_trip_dedup: that function carries the TOCTOU dedup fix
-- (memory: duplicate-trips 2026-08-10) and is not worth destabilising
-- for this.
--
-- The trigger swallows its own errors. A sick reminder queue must never
-- fail a trip insert — the same contract the TypeScript caller has.
--
-- NOT CHANGED HERE: the feature flag. isTripNotificationsEnabled() still
-- gates the cron, which is the switch that controls actual sending. The
-- queue filling up is harmless on its own.

-- ---------------------------------------------------------------------------
-- 1. Re-time the slot grid (09:00 -> 06:00 UTC)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enqueue_trip_notifications(
  p_trip_id UUID,
  p_user_id UUID
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Must stay strictly BELOW the cron hour (07:00 UTC) or slots slip a
  -- full day. See the header note.
  SLOT_HOUR CONSTANT INTERVAL := INTERVAL '6 hours';
  v_start   TIMESTAMPTZ;
  v_muted   BOOLEAN;
  v_count   INT := 0;
BEGIN
  SELECT
    start_date::timestamptz + SLOT_HOUR,
    COALESCE(reminders_muted, FALSE)
  INTO v_start, v_muted
  FROM trips
  WHERE id = p_trip_id AND user_id = p_user_id;

  IF v_start IS NULL OR v_muted OR v_start < NOW() THEN
    DELETE FROM scheduled_notifications
     WHERE trip_id = p_trip_id AND status = 'pending';
    RETURN 0;
  END IF;

  DELETE FROM scheduled_notifications
   WHERE trip_id = p_trip_id AND status = 'pending';

  INSERT INTO scheduled_notifications (user_id, trip_id, slot, scheduled_for)
  SELECT
    p_user_id,
    p_trip_id,
    slot,
    v_start - offset_intv
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
$$;

COMMENT ON FUNCTION public.enqueue_trip_notifications(UUID, UUID) IS
  'Idempotent enqueue of the 5-slot pre-trip reminder cascade. Slots land at 06:00 UTC so the 07:00 UTC cron picks them up the SAME day (they were at 09:00, which cost every reminder a full day). Returns rows inserted; 0 if muted / no start_date / start in past.';

-- Re-time the rows already queued at 09:00 so existing trips benefit too.
-- Only pending rows: sent/suppressed rows are history and must not move.
-- date_trunc on a timestamptz resolves in the SESSION timezone, which is not
-- guaranteed here, so the UTC day boundary is named explicitly. Getting this
-- wrong would shift every pending row by the session's UTC offset.
UPDATE public.scheduled_notifications
   SET scheduled_for = (date_trunc('day', scheduled_for AT TIME ZONE 'UTC')
                        + INTERVAL '6 hours') AT TIME ZONE 'UTC',
       updated_at    = NOW()
 WHERE status = 'pending'
   AND scheduled_for <> (date_trunc('day', scheduled_for AT TIME ZONE 'UTC')
                         + INTERVAL '6 hours') AT TIME ZONE 'UTC';

-- ---------------------------------------------------------------------------
-- 2. Enqueue on INSERT, regardless of which client wrote the row
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trg_enqueue_trip_notifications()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Anonymous trips have nobody to email. They get their cascade if and
  -- when they are claimed (the claim path UPDATEs user_id, and the
  -- existing PATCH route re-enqueues).
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM public.enqueue_trip_notifications(NEW.id, NEW.user_id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never fail a trip insert because the reminder queue is unhappy.
  -- Mirrors the best-effort contract in lib/notifications/scheduling.ts.
  RAISE WARNING 'enqueue_trip_notifications trigger failed for trip %: %',
    NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trips_enqueue_notifications ON public.trips;
CREATE TRIGGER trips_enqueue_notifications
  AFTER INSERT ON public.trips
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_enqueue_trip_notifications();

COMMENT ON FUNCTION public.trg_enqueue_trip_notifications() IS
  'AFTER INSERT on trips -> enqueue the pre-trip cascade. Exists because the wizard calls persistTrip from the BROWSER, where scheduling.ts short-circuits on its typeof-window guard, so 146 of 164 upcoming trips had no reminders. Swallows errors: a trip insert must never fail on the reminder queue.';
