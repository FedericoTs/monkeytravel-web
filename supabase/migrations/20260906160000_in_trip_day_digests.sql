-- Live Trip plan, Phase 4.1 — the in-trip evening-before digest.
--
-- One digest per trip day (day 2..N): "Tomorrow: Day 3 — Alfama …", deep-linked
-- to Today. It is the re-open trigger for the days OF a trip; the pre-trip
-- cascade only covers the run-up, and the post-trip followups only the aftermath.
--
-- REUSES scheduled_notifications, exactly as the post-trip followups did
-- (20260827130000): the queue already gives per-(trip,slot) idempotency, the
-- daily 07:00 UTC cron sweep, the 1-email-per-trip-per-24h rate limit, the
-- reminders_muted honour, the cancelled-trip skip, and owner-only RLS. The only
-- new thing is one row per trip day instead of a fixed five.
--
-- CONSENT: transactional. The owner created the trip and is ON it — this is the
-- same category as the pre-trip cascade, gated on tripReminders (never
-- marketing). Enforced in lib/email/send.ts via
-- NOTIFICATION_SETTING_KEY['trip_day_digest'].
--
-- TIMING (decided 2026-09-06): the cron runs ONCE daily at 07:00 UTC, so a
-- "19:00 trip-local" stamp would slip a day — the 22h-lag bug 20260827120000
-- fixed. The digest for day K is therefore stamped 06:00 UTC (below the cron
-- hour) on the trip-local day BEFORE day K: a reliable ~1-day-ahead heads-up,
-- not literally 19:00 local. The arithmetic is mirrored, and unit-tested, in
-- lib/notifications/digest.ts.
--
-- SLOTS: 'in_trip_day_<K>' for K in 2..21 (day 1 is departure day, already
-- served by confirm_1d / morning_of; 21 = the multi-city trip cap). One slot
-- value per day keeps the existing UNIQUE (trip_id, slot) + ON CONFLICT
-- machinery untouched — no schema change beyond widening the CHECK.

-- ---------------------------------------------------------------------------
-- 1. Widen the slot vocabulary to admit the per-day digest slots.
-- ---------------------------------------------------------------------------

ALTER TABLE public.scheduled_notifications
  DROP CONSTRAINT IF EXISTS scheduled_notifications_slot_check;

ALTER TABLE public.scheduled_notifications
  ADD CONSTRAINT scheduled_notifications_slot_check CHECK (
    slot IN (
      -- pre-trip cascade (transactional, gated tripReminders)
      'pack_early_14d','visa_check_7d','weather_3d','confirm_1d','morning_of',
      -- post-trip re-engagement (marketing, gated marketingNotifications)
      'followup_return_3d','followup_next_21d','followup_final_45d','followup_dormant'
    )
    -- in-trip evening-before digest (transactional, gated tripReminders):
    -- in_trip_day_2 .. in_trip_day_21
    OR slot ~ '^in_trip_day_([2-9]|1[0-9]|2[01])$'
  );

COMMENT ON TABLE public.scheduled_notifications IS
  'Scheduled email queue: pre-trip cascade (transactional, tripReminders), in-trip day digests in_trip_day_<K> (transactional, tripReminders), and post-trip re-engagement followup_* (marketing, marketingNotifications). Drained by app/api/cron/scheduled-notifications. UNIQUE (trip_id, slot) keeps enqueue re-runnable. RLS: owners read; service-role writes.';

-- ---------------------------------------------------------------------------
-- 2. enqueue_trip_day_digests — idempotent, forward-only, owner recipient.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enqueue_trip_day_digests(
  p_trip_id UUID,
  p_user_id UUID
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  -- Strictly below the 07:00 UTC cron hour, same as every other slot.
  SLOT_HOUR CONSTANT INTERVAL := INTERVAL '6 hours';
  MAX_DAY   CONSTANT INT := 21;
  v_start     DATE;
  v_end       DATE;
  v_muted     BOOLEAN;
  v_cancelled BOOLEAN;
  v_ndays     INT;
  v_count     INT := 0;
BEGIN
  SELECT start_date, end_date, COALESCE(reminders_muted, FALSE), status = 'cancelled'
    INTO v_start, v_end, v_muted, v_cancelled
    FROM trips
   WHERE id = p_trip_id AND user_id = p_user_id AND deleted_at IS NULL;

  v_ndays := LEAST(MAX_DAY, (COALESCE(v_end, v_start) - v_start) + 1);

  IF v_start IS NULL OR v_muted OR COALESCE(v_cancelled, FALSE) OR v_ndays < 2 THEN
    DELETE FROM scheduled_notifications
     WHERE trip_id = p_trip_id AND status = 'pending' AND slot LIKE 'in_trip_day_%';
    RETURN 0;
  END IF;

  -- Idempotent re-enqueue: drop pending digests, re-insert from the current
  -- dates. Sent rows survive (rate-limit history + no re-send); a suppressed
  -- FUTURE day is revived on conflict, matching enqueue_trip_notifications
  -- (20260902170000) so a one-off suppression can't wedge a trip forever.
  DELETE FROM scheduled_notifications
   WHERE trip_id = p_trip_id AND status = 'pending' AND slot LIKE 'in_trip_day_%';

  INSERT INTO scheduled_notifications (user_id, trip_id, slot, scheduled_for)
  SELECT
    p_user_id,
    p_trip_id,
    'in_trip_day_' || k,
    ((v_start + (k - 2))::timestamp AT TIME ZONE 'UTC') + SLOT_HOUR
  FROM generate_series(2, v_ndays) AS k
  WHERE ((v_start + (k - 2))::timestamp AT TIME ZONE 'UTC') + SLOT_HOUR > NOW()
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
$fn$;

REVOKE ALL ON FUNCTION public.enqueue_trip_day_digests(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_trip_day_digests(UUID, UUID) TO service_role;

COMMENT ON FUNCTION public.enqueue_trip_day_digests(UUID, UUID) IS
  'Idempotent enqueue of the in-trip evening-before digests (slots in_trip_day_2..21), one per trip day, stamped 06:00 UTC on the day before each day so the 07:00 UTC cron delivers a ~1-day-ahead heads-up. Owner recipient; transactional (gated tripReminders). Returns rows written; 0 if muted / cancelled / <2 days / no start_date.';

-- ---------------------------------------------------------------------------
-- 3. Hang the digest off the same AFTER INSERT trigger as the other halves,
--    so a trip saved today queues its whole lifecycle at once.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trg_enqueue_trip_notifications()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $tg$
BEGIN
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM public.enqueue_trip_notifications(NEW.id, NEW.user_id);
  PERFORM public.enqueue_trip_followups(NEW.id, NEW.user_id);
  PERFORM public.enqueue_trip_day_digests(NEW.id, NEW.user_id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'trip notification enqueue trigger failed for trip %: %',
    NEW.id, SQLERRM;
  RETURN NEW;
END;
$tg$;
