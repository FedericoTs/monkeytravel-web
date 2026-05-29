-- Re-enable AI generation cache for Backpacker Mode.
--
-- Background: when Backpacker Mode shipped (commit b9f50cb +
-- causality fix b4703a7), the destination_activity_cache key was
-- (destination_hash, budget_tier, vibes, language) — no travel_style
-- column. A backpacker user with the same (dest, vibes, budget) tuple
-- as a previous classic user would hit the cache and silently receive
-- a non-backpacker plan.
--
-- The interim fix was to skip cache entirely for backpacker generations.
-- Cost: every backpacker generation paid an extra ~$0.02-0.05 in
-- Gemini fees.
--
-- This migration promotes travel_style to a real column + part of the
-- unique key. Old cache rows backfill as 'classic' (which is correct —
-- they were generated before Backpacker Mode existed). New backpacker
-- rows live alongside their classic siblings without collision.
--
-- The follow-up code commit drops the skip-cache hack in
-- app/api/ai/generate/route.ts. After deploy, backpacker generations
-- are cached and reused like classic.
--
-- Applied to prod 2026-05-28 via Supabase MCP. See docs/MIGRATION_PLAN.md
-- Tier 1.2 for context.

ALTER TABLE public.destination_activity_cache
  ADD COLUMN IF NOT EXISTS travel_style TEXT NOT NULL DEFAULT 'classic';

-- The unique index was owned by a NAMED CONSTRAINT — must drop the
-- constraint (which drops the backing index), not the bare index.
ALTER TABLE public.destination_activity_cache
  DROP CONSTRAINT IF EXISTS unique_destination_cache_lang;

CREATE UNIQUE INDEX IF NOT EXISTS unique_destination_cache_lang_v2
  ON public.destination_activity_cache
  (destination_hash, budget_tier, vibes, language, travel_style);

-- Lookup index — include travel_style so the SELECT scans this
-- index instead of falling back to idx_dest_cache_hash.
DROP INDEX IF EXISTS public.idx_destination_cache_lookup;
CREATE INDEX IF NOT EXISTS idx_destination_cache_lookup_v2
  ON public.destination_activity_cache
  (destination_hash, budget_tier, language, travel_style, expires_at DESC);

COMMENT ON COLUMN public.destination_activity_cache.travel_style IS
  'Travel-style preset from the wizard (classic | backpacker). Part of the cache key so backpacker results do not leak to classic users (and vice versa).';
