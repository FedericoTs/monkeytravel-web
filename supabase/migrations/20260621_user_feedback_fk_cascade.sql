-- 2026-06-21 — GDPR erasure fix for user_feedback (follow-up to create_user_feedback).
-- Applied to prod via apply_migration ("user_feedback_fk_cascade").
--
-- The original FK used ON DELETE SET NULL. Because contact_email and the
-- free-text answers are standalone columns (not derivable from user_id),
-- SET NULL left that PII in the table after an account was deleted and made
-- it un-locatable by user_id — an unfulfillable Art.17 erasure. CASCADE makes
-- a user's feedback rows die with their auth.users row.
--
-- (Future email_link/newsletter rows that carry a NULL user_id are not covered
-- by this cascade and would need an erasure-by-email path if/when added.)

ALTER TABLE public.user_feedback DROP CONSTRAINT user_feedback_user_id_fkey;
ALTER TABLE public.user_feedback
  ADD CONSTRAINT user_feedback_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
