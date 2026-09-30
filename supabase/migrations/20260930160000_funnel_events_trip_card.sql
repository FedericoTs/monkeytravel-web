-- funnel_events accepts the trip card's two events.
--
-- trip_card_rendered: /api/og/trip drew a trip's card, for a link preview
-- being unfurled or for the owner's "share as an image". The CDN keeps each
-- card URL for a day in each region, so a row is a cache miss, not a view.
-- trip_card_shared: the owner shared or downloaded the image. Until now it was
-- a PostHog event only, which fires just for visitors who accepted analytics.
ALTER TABLE public.funnel_events DROP CONSTRAINT IF EXISTS funnel_events_event_type_check;
ALTER TABLE public.funnel_events ADD CONSTRAINT funnel_events_event_type_check
  CHECK (event_type = ANY (ARRAY[
    'share_link_created'::text,
    'share_link_visited'::text,
    'vote_cast'::text,
    'plan_own_clicked'::text,
    'trip_claimed'::text,
    'trip_card_rendered'::text,
    'trip_card_shared'::text
  ]));
