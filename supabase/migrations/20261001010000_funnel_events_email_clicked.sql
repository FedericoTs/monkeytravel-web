-- funnel_events accepts email_clicked.
--
-- Reminder, digest and follow-up emails link with ?slot=<queue slot>, and
-- nothing recorded it, so whether an email brought anyone back was unknown.
-- The middleware now writes one row per counted view carrying a known slot
-- (lib/analytics/email-click.ts), before any sign-in or share-link redirect.
ALTER TABLE public.funnel_events DROP CONSTRAINT IF EXISTS funnel_events_event_type_check;
ALTER TABLE public.funnel_events ADD CONSTRAINT funnel_events_event_type_check
  CHECK (event_type = ANY (ARRAY[
    'share_link_created'::text,
    'share_link_visited'::text,
    'vote_cast'::text,
    'plan_own_clicked'::text,
    'trip_claimed'::text,
    'trip_card_rendered'::text,
    'trip_card_shared'::text,
    'email_clicked'::text
  ]));
