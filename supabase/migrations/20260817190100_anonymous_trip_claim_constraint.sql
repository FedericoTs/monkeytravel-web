-- Anonymous share loop, part 2 — widen the no-orphan-trips CHECK.
--
-- The original constraint was:
--   CHECK (is_template = true OR user_id IS NOT NULL)
-- Its job is to stop orphan trips existing at all, with templates as the only
-- sanctioned ownerless rows. `trips.user_id` is nullable ONLY to permit those
-- templates — a detail easy to miss by reading information_schema alone, and
-- the reason the first version of the anonymous-create route would have failed
-- at runtime with a check_violation.
--
-- The anonymous share loop needs a second kind of ownerless row: a trip a
-- signed-out planner shared, waiting to be claimed. Rather than simply
-- allowing `user_id IS NULL`, the new exception is STRICTER than the one it
-- joins — an anonymous row must carry BOTH a claim_token and a
-- claim_expires_at. That makes a permanent orphan impossible by construction:
-- every ownerless non-template row is guaranteed to be reachable by the
-- sweeper in /api/cron/sweep-unclaimed-trips, which filters on exactly those
-- two columns plus the expiry.
--
-- Verified after applying (8/8):
--   ownerless + token + expiry   -> allowed
--   ownerless, no token          -> rejected
--   ownerless, token, no expiry  -> rejected

alter table public.trips drop constraint if exists trips_user_id_required_for_non_templates;

alter table public.trips
  add constraint trips_user_id_required_for_non_templates
  check (
    is_template = true
    or user_id is not null
    or (claim_token is not null and claim_expires_at is not null)
  );

comment on constraint trips_user_id_required_for_non_templates on public.trips is
  'No orphan trips. An ownerless row must be either a template or an anonymous claimable trip, and an anonymous one MUST carry both a claim_token and an expiry so the sweeper can always reclaim it. Widened 2026-08-17 for the anonymous share loop.';
