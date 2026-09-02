-- Release the 2026-08-27 hold for trips that have not happened yet.
--
-- The hold was a sensible brake when the trip email loops shipped. It was
-- never lifted, and six days later it still held 611 future rows covering
-- 129 live trips and 106 real users — every one of them with an upcoming trip
-- and no pre-trip reminder queued at all. Until 20260902170000 nothing could
-- lift it: a suppressed row blocked its own re-enqueue.
--
-- NARROW BY DESIGN. Only rows whose moment is still in the future, and only
-- for trips that are live, uncancelled and unmuted. Anything whose moment has
-- passed stays suppressed: the cron's per-slot staleness guard was written
-- because of this very hold, and a released "Travel day" for a trip that
-- already started is worse than silence.
--
-- MEASURED BEFORE APPLYING: 606 deliverable rows / 129 trips / 106 users;
-- 0 cancelled, 0 muted, 0 opted out of tripReminders, 0 whose trip has
-- already started. A trickle rather than a blast — 4 rows due in the next
-- 24h, 68 within a week, busiest single day 14. The copy is known good: the
-- i18n key-path bug was fixed 2026-08-19, assertTranslated() now fails a row
-- rather than mailing a key path, and the cron has sent correctly every
-- morning since (latest 2026-09-02) with zero failed rows.

UPDATE public.scheduled_notifications sn
   SET status         = 'pending',
       skipped_reason = NULL,
       updated_at     = NOW()
  FROM public.trips t
 WHERE t.id = sn.trip_id
   AND sn.skipped_reason = 'manual_hold_2026_08_27'
   AND sn.status         = 'suppressed'
   AND sn.scheduled_for  > NOW()
   AND t.deleted_at IS NULL
   AND COALESCE(t.status, '')             <> 'cancelled'
   AND COALESCE(t.reminders_muted, FALSE) = FALSE;
