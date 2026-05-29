-- Acquisition source tracking for partner attribution.
--
-- Captured from the `utm_source` query param at first page hit (via
-- middleware-set cookie) and persisted on user creation. Lets us answer
-- "how many users came from the Hostelworld landing page" without
-- needing a CRM or external attribution tool.
--
-- TEXT not enum: we want to add new sources (utm campaigns, partner
-- referrals, organic-search variants) without a migration each time.
-- Cardinality stays low (<20 distinct values expected) so the index
-- is cheap.
--
-- Indexed because the partner-reporting query is `COUNT(*) WHERE
-- acquisition_source = 'hostelworld'` and we run it on demand.
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS acquisition_source text;

CREATE INDEX IF NOT EXISTS users_acquisition_source_idx
ON public.users (acquisition_source)
WHERE acquisition_source IS NOT NULL;

COMMENT ON COLUMN public.users.acquisition_source IS
'UTM source captured at signup time from the mt_utm_source cookie. Examples: hostelworld, organic, twitter. NULL = pre-attribution-tracking user.';
