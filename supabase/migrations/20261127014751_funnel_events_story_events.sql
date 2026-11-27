-- funnel_events accepts story_guessed and story_finished.
--
-- A friend's guess on a trip's story, and a story watched to its last part,
-- reached only the visitors who accepted analytics. These two rows count them
-- for everyone: the trip, the browser's session and how the guess went.
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
    'email_clicked'::text,
    'story_guessed'::text,
    'story_finished'::text
  ]));
