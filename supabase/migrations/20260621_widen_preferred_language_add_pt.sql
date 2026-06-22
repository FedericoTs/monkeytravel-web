-- 2026-06-21 — Allow 'pt' as a users.preferred_language (SEO/i18n).
-- Applied to prod via apply_migration ("widen_users_preferred_language_check_add_pt").
-- This file is the canonical repo record + replay path.
--
-- WHY: pt / pt-BR launched 2026-06-15 (routing locale 'pt'). auth/callback +
-- signup set users.preferred_language to the request locale, but the CHECK
-- allowed only ('en','es','it') — so a pt-locale signup would violate it and
-- silently fail to capture the language (the same defaulted/blocked-column
-- footgun seen elsewhere). Widen the allow-list to include 'pt'.

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_preferred_language_check;
ALTER TABLE public.users ADD CONSTRAINT users_preferred_language_check
  CHECK (preferred_language = ANY (ARRAY['en'::text, 'es'::text, 'it'::text, 'pt'::text]));
