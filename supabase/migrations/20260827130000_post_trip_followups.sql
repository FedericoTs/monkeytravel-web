-- Loop 2 — post-trip re-engagement.
--
-- Audience (measured 2026-08-27): 93 users have exactly one trip whose
-- end_date has passed; 92 of them have not opted out of marketing. That
-- is the whole addressable set, and it is small — this exists because it
-- compounds as the base grows, not because it moves a quarter.
--
-- The 201 "one-and-done" users often quoted are NOT the target: 94 of
-- them have a trip still upcoming and 9 are travelling right now. Those
-- are served by the pre-trip cascade, not by this.
--
-- WHY THIS REUSES scheduled_notifications
-- ---------------------------------------
-- The existing queue already provides everything this needs: per-(trip,
-- slot) uniqueness, the daily cron sweep, the 1-email-per-trip-per-24h
-- rate limit, the reminders_muted honour, and owner-only RLS. A parallel
-- table would duplicate all of it and drift. The only real difference is
-- which side of the trip the offset hangs off, and which consent key
-- gates the send.
--
-- CONSENT — THE IMPORTANT DIFFERENCE
-- ----------------------------------
-- Pre-trip reminders are transactional: the recipient created the trip
-- and asked to be reminded. These are NOT. Nobody triggered this send.
-- They are gated on marketingNotifications, never tripReminders — a
-- reminder opt-in is not permission to market. Enforced in
-- lib/email/send.ts via NOTIFICATION_SETTING_KEY['trip_followup'].
--
-- SLOTS
-- -----
--   followup_return_3d   end_date +3d   "How was {destination}?"
--   followup_next_21d    end_date +21d  "Thinking about the next one?"
--   followup_final_45d   end_date +45d  "Last one from us" — then silence
--   followup_dormant     one-time catch-up, see below
--
-- WHY followup_dormant EXISTS
-- ---------------------------
-- The 92 already-returned users averaged 59 days since their trip; some
-- are past six months. Scheduling them "end_date + 3 days" puts every
-- slot in the past, so they would receive nothing — and back-dating them
-- to now would send "You got back a few days ago" to someone who
-- returned in March. Its copy therefore makes no claim about elapsed
-- time, so it reads correctly at any distance. One email, then done.
--
-- followup_dormant is NOT enqueued automatically. It is a one-time
-- catch-up fired by hand via enqueue_dormant_followups() after the copy
-- has been reviewed. Everything else here is automatic and forward-only.

-- ---------------------------------------------------------------------------
-- 1. Widen the slot vocabulary
-- ---------------------------------------------------------------------------

ALTER TABLE public.scheduled_notifications
  DROP CONSTRAINT IF EXISTS scheduled_notifications_slot_check;

ALTER TABLE public.scheduled_notifications
  ADD CONSTRAINT scheduled_notifications_slot_check CHECK (slot IN (
    -- pre-trip cascade (transactional, gated tripReminders)
    'pack_early_14d','visa_check_7d','weather_3d','confirm_1d','morning_of',
    -- post-trip re-engagement (marketing, gated marketingNotifications)
    'followup_return_3d','followup_next_21d','followup_final_45d','followup_dormant'
  ));

COMMENT ON TABLE public.scheduled_notifications IS
  'Scheduled email queue for BOTH the pre-trip cascade (transactional, gated tripReminders) and post-trip re-engagement (marketing, gated marketingNotifications). Slot prefix decides which: followup_* are marketing. Drained by app/api/cron/scheduled-notifications. UNIQUE (trip_id, slot) keeps enqueue re-runnable. RLS: owners read; service-role writes.';

-- ---------------------------------------------------------------------------
-- 2. Forward-only enqueue for newly-finished trips
-- ---------------------------------------------------------------------------

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
  -- Same 06:00 UTC grid as the pre-trip cascade, for the same reason:
  -- the dispatching cron runs at 07:00 UTC, so anything later than that
  -- slips a full day. See 20260827120000.
  SLOT_HOUR CONSTANT INTERVAL := INTERVAL '6 hours';
  v_end     TIMESTAMPTZ;
  v_muted   BOOLEAN;
  v_count   INT := 0;
BEGIN
  SELECT
    end_date::timestamptz + SLOT_HOUR,
    COALESCE(reminders_muted, FALSE)
  INTO v_end, v_muted
  FROM trips
  WHERE id = p_trip_id AND user_id = p_user_id AND deleted_at IS NULL;

  IF v_end IS NULL OR v_muted THEN
    DELETE FROM scheduled_notifications
     WHERE trip_id = p_trip_id AND status = 'pending' AND slot LIKE 'followup_%';
    RETURN 0;
  END IF;

  -- Idempotent: drop pending followups, re-insert from the current
  -- end_date. Sent rows survive so the 24h rate-limit history holds.
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

COMMENT ON FUNCTION public.enqueue_trip_followups(UUID, UUID) IS
  'Idempotent enqueue of the 3-slot post-trip re-engagement sequence, offset from end_date on the same 06:00 UTC grid as the pre-trip cascade. Marketing, not transactional — the cron gates on marketingNotifications and suppresses when the user has more than one trip.';

-- Hang it off the same INSERT that seeds the pre-trip cascade, so a trip
-- saved today queues both halves of its lifecycle at once. Past-dated
-- slots are skipped by the WHERE above, so a trip created after it ended
-- (an import, a backfill) simply gets fewer rows.
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
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'trip notification enqueue trigger failed for trip %: %',
    NEW.id, SQLERRM;
  RETURN NEW;
END;
$tg$;

-- ---------------------------------------------------------------------------
-- 3. One-time catch-up for users who already went quiet
-- ---------------------------------------------------------------------------
--
-- Deliberately a callable function rather than something the trigger or
-- the cron does on its own: it is a one-shot blast to a real audience
-- and should be fired knowingly, once, after the copy is signed off.
--
-- p_stagger_days spreads the sends so the whole cohort does not land in
-- one daily cron run — that would be both a deliverability spike and a
-- support spike. With the default 7 and ~92 recipients it is ~13/day.
--
-- p_dry_run returns the count WITHOUT writing, so the blast radius can
-- be checked before committing to it.

-- The cohort is defined once, here, so the dry run and the real write can
-- never disagree about who is in it. (A temp table inside the enqueue
-- function would have been the obvious shape, but a plpgsql function that
-- creates and then reads its own temp table is exactly the pattern that
-- breaks under plan caching on the second call in a session.)
CREATE OR REPLACE FUNCTION public.dormant_followup_candidates(
  p_stagger_days INT DEFAULT 7
)
RETURNS TABLE (user_id UUID, trip_id UUID, send_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  WITH one_and_done AS (
    -- (array_agg(...))[1] rather than MIN(t.id): Postgres has no MIN for
    -- uuid. The HAVING below constrains the group to exactly one trip, so
    -- "the first" and "the only" are the same row.
    SELECT t.user_id           AS uid,
           (array_agg(t.id))[1] AS tid
    FROM trips t
    JOIN users u ON u.id = t.user_id
    WHERE t.deleted_at IS NULL
      AND COALESCE(t.reminders_muted, FALSE) = FALSE
      AND u.email IS NOT NULL
      -- Consent is re-checked at dispatch too; filtering here keeps the
      -- queue honest rather than filling it with rows that can only ever
      -- be suppressed later.
      AND COALESCE(u.notification_settings->>'marketingNotifications','') <> 'false'
      AND COALESCE(u.notification_settings->>'emailNotifications','') <> 'false'
    GROUP BY t.user_id
    HAVING COUNT(DISTINCT t.id) = 1
       AND MAX(t.end_date) < CURRENT_DATE
  )
  SELECT
    o.uid,
    o.tid,
    -- Deterministic spread: hashing the user id keeps re-runs stable.
    -- random() would reshuffle between the dry run and the real one, so
    -- the preview would not describe the thing that actually happens.
    (date_trunc('day', NOW() AT TIME ZONE 'UTC')
       + INTERVAL '1 day'
       + (abs(hashtext(o.uid::text)) % GREATEST(p_stagger_days,1)) * INTERVAL '1 day'
       + INTERVAL '6 hours') AT TIME ZONE 'UTC'
  FROM one_and_done o
  WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_notifications s
    WHERE s.trip_id = o.tid AND s.slot = 'followup_dormant'
  );
$fn$;

CREATE OR REPLACE FUNCTION public.enqueue_dormant_followups(
  p_stagger_days INT DEFAULT 7,
  p_dry_run BOOLEAN DEFAULT TRUE
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_count INT := 0;
BEGIN
  IF p_dry_run THEN
    SELECT COUNT(*) INTO v_count
      FROM public.dormant_followup_candidates(p_stagger_days);
    RETURN v_count;
  END IF;

  INSERT INTO scheduled_notifications (user_id, trip_id, slot, scheduled_for)
  SELECT c.user_id, c.trip_id, 'followup_dormant', c.send_at
    FROM public.dormant_followup_candidates(p_stagger_days) c
  ON CONFLICT (trip_id, slot) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$fn$;

-- All three are SECURITY DEFINER and read across every user's rows, so
-- PUBLIC must not keep the default EXECUTE that CREATE FUNCTION grants.
-- dormant_followup_candidates in particular would otherwise let any
-- authenticated caller enumerate other users' trip ids.
REVOKE ALL ON FUNCTION public.enqueue_trip_followups(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_trip_followups(UUID, UUID) TO service_role;
REVOKE ALL ON FUNCTION public.dormant_followup_candidates(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dormant_followup_candidates(INT) TO service_role;
REVOKE ALL ON FUNCTION public.enqueue_dormant_followups(INT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_dormant_followups(INT, BOOLEAN) TO service_role;

COMMENT ON FUNCTION public.enqueue_dormant_followups(INT, BOOLEAN) IS
  'One-shot catch-up: queues followup_dormant for users with exactly one trip that has already ended. Defaults to DRY RUN — pass p_dry_run => false to actually write. Staggered deterministically over p_stagger_days so the cohort does not land in a single cron run.';
