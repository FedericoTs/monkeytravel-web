-- Where a wizard session came from, on its step-1 row.
--
-- On 2026-09-29, 51 sessions left step 1 against a 21/day average, 37 of
-- them in under ten seconds and 18 in Italian, and nothing on the row said
-- where they had come from: a bouncing traffic source and a product wall
-- look the same. The referrer of the wizard document and the utm_source of
-- its URL are enough to tell them apart; the landing path is already in
-- page_views_human by session. Only step_1_destination_dates carries them.

ALTER TABLE public.wizard_step_events
  ADD COLUMN IF NOT EXISTS referrer text,
  ADD COLUMN IF NOT EXISTS utm_source text;
