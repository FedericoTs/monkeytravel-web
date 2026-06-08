-- Capture WHY users discard a trip / start over. The david-cassoni incident
-- showed that we had zero visibility into why a freshly-generated trip got
-- discarded -- was the destination wrong? Dates? Suggestions? Made-by-mistake?
-- Without this signal we can't tell which generation-quality dimension to
-- improve, or which UX path created the regret.
--
-- One row per discard. Joined to the trip via trip_id so we can compute
-- "% of discards where destination was the issue" by destination, etc.

CREATE TABLE IF NOT EXISTS public.trip_deletion_feedback (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- We do NOT FK to trips(id) -- the trip is being soft-deleted at the
  -- same time and we want this row to outlive any future hard-delete
  -- of the tombstone. Stored as text so it survives independently.
  trip_id      TEXT NOT NULL,
  destination  TEXT,
  -- Reason picker. Adding new values is an ALTER TYPE; keep this list
  -- short and stable. "other" + a free-text custom_reason covers the long tail.
  reason       TEXT NOT NULL CHECK (reason IN (
    'wrong_destination',
    'wrong_dates',
    'didnt_like_suggestions',
    'too_expensive',
    'made_by_mistake',
    'other'
  )),
  custom_reason TEXT,
  -- How long after creation was the trip discarded? Lets us segment
  -- "fast regret" (<5 min) from "considered then abandoned".
  trip_age_seconds INTEGER,
  -- Was the trip auto-saved (i.e. persisted to DB) at discard time?
  -- Distinguishes "I discarded a draft" from "I deleted a saved trip".
  was_auto_saved BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS trip_deletion_feedback_user_id_idx
  ON public.trip_deletion_feedback (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS trip_deletion_feedback_reason_idx
  ON public.trip_deletion_feedback (reason, created_at DESC);

ALTER TABLE public.trip_deletion_feedback ENABLE ROW LEVEL SECURITY;

-- INSERT: any authenticated user can write their OWN feedback row.
-- (No SELECT/UPDATE/DELETE policies -- admin reads via service-role.)
CREATE POLICY trip_deletion_feedback_insert_own
  ON public.trip_deletion_feedback
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

COMMENT ON TABLE public.trip_deletion_feedback IS
  'Sean-Ellis-style "why did you discard" signal. Captured by the Start Over modal in app/[locale]/trips/new/NewTripWizard.tsx via /api/trips/[id]/deletion-feedback. Service-role-only reads.';
