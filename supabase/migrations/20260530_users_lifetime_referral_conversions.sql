-- Add users.lifetime_referral_conversions — the denormalized counter
-- the referral completion code has been trying to UPDATE since launch.
--
-- Bug context (caught 2026-05-30 via E2E test):
--   lib/referral/completion.ts (line 218) and app/api/referral/complete/route.ts
--   (line 166) both run:
--
--     UPDATE users SET
--       lifetime_referral_conversions = newConversionCount,
--       referral_tier = effectiveTier
--     WHERE id = referrer_id
--
--   The column never existed. Postgres rejected the whole statement,
--   meaning referral_tier ALSO never updated — so the tier-based AI
--   generations bonus (+2/+5/+12 per month) never actually applied,
--   even when a referrer crossed the 3/6/10-conversion thresholds.
--   The free_trips_remaining +1 reward still worked because that's
--   a separate UPDATE earlier in the function.
--
--   app/[locale]/trips/page.tsx also SELECTs this column to drive the
--   "0/3 referral per Esploratore" progress banner — that read silently
--   returned undefined → banner stuck at 0 even after conversions.
--
-- Fix: add the column with sensible default, then backfill from the
-- existing source of truth (referral_codes.total_conversions). Safe to
-- run on a live DB: ADD COLUMN with DEFAULT is metadata-only on PG 11+.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS lifetime_referral_conversions INTEGER NOT NULL DEFAULT 0;

-- Backfill from referral_codes (the single source of truth that HAS been
-- tracked correctly all along). For users without a referral code, the
-- default of 0 stays — they've sent zero referrals.
UPDATE users u
SET lifetime_referral_conversions = COALESCE(rc.total_conversions, 0)
FROM referral_codes rc
WHERE rc.user_id = u.id
  AND COALESCE(rc.total_conversions, 0) > 0;

-- Index for the leaderboard query (lib/bananas/tiers.ts checkAndUnlockTier
-- and the future "top referrers" view). Cheap — table is small.
CREATE INDEX IF NOT EXISTS users_lifetime_referral_conversions_idx
  ON users (lifetime_referral_conversions DESC)
  WHERE lifetime_referral_conversions > 0;

COMMENT ON COLUMN users.lifetime_referral_conversions IS
  'Denormalized counter — kept in sync with referral_codes.total_conversions by the referral completion path. Read by trips/page.tsx for the progress banner and by usage-limits/check.ts via referral_tier for the bonus.';
