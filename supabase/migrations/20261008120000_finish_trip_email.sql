-- "Finish your first trip": one email per new account, queued when the
-- account is created and sent by the daily notifications cron about a day
-- later. The cron drops it when the account owns or has joined a trip by then
-- (lib/notifications/finish-trip.ts). It is the queue's only slot that belongs
-- to an account rather than a trip, so trip_id is null for it and only for it.
--
-- Only accounts created after this migration are queued: there is no backfill.

alter table public.scheduled_notifications alter column trip_id drop not null;

alter table public.scheduled_notifications drop constraint scheduled_notifications_slot_check;
alter table public.scheduled_notifications add constraint scheduled_notifications_slot_check check (
  slot = any (array[
    'pack_early_14d', 'visa_check_7d', 'weather_3d', 'confirm_1d', 'morning_of',
    'followup_return_3d', 'followup_next_21d', 'followup_final_45d', 'followup_dormant',
    'finish_trip_1d'
  ])
  or slot ~ '^in_trip_day_([2-9]|1[0-9]|2[01])$'
);

alter table public.scheduled_notifications add constraint scheduled_notifications_trip_scope_check
  check ((trip_id is null) = (slot = 'finish_trip_1d'));

-- One account-level row per user and slot. (trip_id, slot) cannot do this:
-- nulls never conflict in a unique index.
create unique index if not exists scheduled_notifications_account_slot_key
  on public.scheduled_notifications (user_id, slot)
  where trip_id is null;

-- Stamped at the 06:00 UTC slot nearest to signup + 24h (12 to 36 hours after
-- signup), so the 07:00 UTC cron sends it about a day later. Test accounts
-- are skipped. A failure here must never block the signup it rides on.
create or replace function public.trg_enqueue_finish_trip_email()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
BEGIN
  IF NEW.email IS NULL OR NEW.email ILIKE '%@test.local' OR NEW.email ILIKE '%@example.com' THEN
    RETURN NEW;
  END IF;

  INSERT INTO scheduled_notifications (user_id, trip_id, slot, scheduled_for)
  VALUES (
    NEW.id,
    NULL,
    'finish_trip_1d',
    (date_trunc('day', (COALESCE(NEW.created_at, NOW()) + INTERVAL '30 hours') AT TIME ZONE 'UTC')
      + INTERVAL '6 hours') AT TIME ZONE 'UTC'
  )
  ON CONFLICT (user_id, slot) WHERE trip_id IS NULL DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'finish_trip_1d enqueue failed for %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;

drop trigger if exists users_enqueue_finish_trip_email on public.users;
create trigger users_enqueue_finish_trip_email
  after insert on public.users
  for each row
  execute function public.trg_enqueue_finish_trip_email();

revoke execute on function public.trg_enqueue_finish_trip_email() from public, anon, authenticated;
