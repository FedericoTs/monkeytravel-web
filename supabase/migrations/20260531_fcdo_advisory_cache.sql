-- FCDO travel-advisory cache (cross-instance, durable).
--
-- Background: lib/visa/govuk-advisory.ts already keeps a per-Lambda
-- in-memory Map keyed by ISO-2 with a 24h TTL. That cache works great
-- on a warm instance — but Vercel cold-starts new instances frequently
-- and every cold-start re-fetches every advisory the page renders.
-- For a visa-checker / trip-detail surface that touches GOV.UK on
-- almost every render, the cold-start fan-out is wasted egress + slow.
--
-- This table is the second tier: a DB-backed cache shared by every
-- instance. Lookup order in the application code is:
--   1. in-memory Map (fastest, per-instance)
--   2. fcdo_advisory_cache (shared, survives cold starts)
--   3. GOV.UK Content API (last resort)
-- Both layers expire at 24h. On upstream fetch we write through to
-- both layers so the next caller — on any instance — hits the DB row
-- without making an outbound request.
--
-- Sensitivity: the rows are literally a copy of a public GOV.UK page.
-- No PII, no business data. RLS allows SELECT for anon + authenticated
-- so the read path doesn't need a service-role client; writes go
-- through service-role only (no INSERT/UPDATE/DELETE policy for
-- non-service roles, so RLS denies by default).

CREATE TABLE IF NOT EXISTS public.fcdo_advisory_cache (
  -- Lowercased ISO-2 country code. Lowercased to match the existing
  -- in-memory cache key normalization in govuk-advisory.ts.
  country_code TEXT PRIMARY KEY,

  -- The capped summary string (≤280 chars in app code). Nullable
  -- because we also cache *negative* results — countries with no
  -- GOV.UK page or a transient fetch error — so we don't re-hit
  -- upstream every render for 24h after a miss.
  summary TEXT,

  -- Human-readable GOV.UK page URL. Nullable for the same reason.
  url TEXT,

  -- FCDO's own last-updated timestamp (passed through from the
  -- Content API's public_updated_at / updated_at). Distinct from
  -- fetched_at — this is "when did GOV.UK change the page", not
  -- "when did we last cache it".
  updated_at TIMESTAMPTZ,

  -- When we wrote this row.
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- When this row should be considered stale. App code checks
  -- expires_at > now() on read; on miss/expiry it re-fetches
  -- upstream and upserts.
  expires_at TIMESTAMPTZ NOT NULL
);

-- Range index for the freshness check (expires_at > now()).
CREATE INDEX IF NOT EXISTS idx_fcdo_advisory_cache_expires_at
  ON public.fcdo_advisory_cache (expires_at);

COMMENT ON TABLE public.fcdo_advisory_cache IS
  'Cross-instance cache of GOV.UK foreign travel advisories. 24h TTL. Read-only for anon/authenticated; service-role only for writes. Mirrors lib/visa/govuk-advisory.ts in-memory cache as a second tier that survives Vercel cold starts.';

-- RLS: lock down by default, then re-open SELECT for everyone.
-- Writes are intentionally policy-less so they only succeed under
-- service-role (which bypasses RLS).
ALTER TABLE public.fcdo_advisory_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fcdo_advisory_cache_select_public"
  ON public.fcdo_advisory_cache;

CREATE POLICY "fcdo_advisory_cache_select_public"
  ON public.fcdo_advisory_cache
  FOR SELECT
  TO anon, authenticated
  USING (true);
