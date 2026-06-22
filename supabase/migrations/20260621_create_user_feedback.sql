-- 2026-06-21 — Power-user demand-discovery feedback (office-hours design doc).
-- Applied to prod via apply_migration ("create_user_feedback").
--
-- One row per submitted survey, from any channel (in-app modal, tokenized email
-- link, newsletter). All writes go through a server route (/api/feedback) using
-- the service-role client (validates session or, later, a signed token), so RLS
-- is locked: no direct anon/authenticated access. Admin reads via service role.

CREATE TABLE IF NOT EXISTS public.user_feedback (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source                 text NOT NULL DEFAULT 'in_app'
                           CHECK (source = ANY (ARRAY['in_app','email_link','newsletter'])),
  uses_for               text,   -- "what do you actually use MonkeyTravel for?"
  almost_stopped         text,   -- "what almost made you stop using it?"
  last_booked_where      text,   -- "where did you book your last trip?"
  would_book_through_us  text,   -- 'yes' | 'no' | 'maybe'
  open_to_chat           boolean NOT NULL DEFAULT false,
  contact_email          text,
  extra                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_feedback_created_at ON public.user_feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_feedback_user_id ON public.user_feedback (user_id);
CREATE INDEX IF NOT EXISTS idx_user_feedback_open_to_chat ON public.user_feedback (open_to_chat) WHERE open_to_chat = true;

ALTER TABLE public.user_feedback ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: only the service-role client can read or write.
