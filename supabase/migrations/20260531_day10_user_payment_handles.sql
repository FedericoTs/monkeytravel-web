-- Day-10: user payment handles for SettleUpView deeplink generation.
--
-- Adds 3 nullable TEXT columns to public.users (the public profile table
-- that mirrors auth.users via the existing handle_new_user trigger).
-- Each holds the user's account identifier for one of the three
-- supported P2P money-transfer providers — PayPal.me, Venmo, Wise.
--
-- WHY columns on public.users (and not a side table):
--   - Cardinality 1:1 with users (each user has zero or one handle per
--     provider — there is no "primary handle vs backup" use case).
--   - Read pattern: SettleUpView fetches the recipient's row once per
--     transfer and renders up to 3 buttons — a JOIN on a side table
--     would be an extra round-trip for zero gain.
--   - Write pattern: edited once at signup-ish (in /profile/payment-handles)
--     then rarely touched. No need for a write-heavy normalised schema.
--   - Existing /api/profile PATCH already covers single-table writes
--     to public.users — extending the allowlist is one line.
--
-- VALIDATION:
--   - Format validation lives at the app layer (lib/payments/handle-links.ts
--     buildXLink + the PATCH /api/profile route's filteredUpdates check).
--     A DB CHECK constraint would either be too strict (handle formats
--     vary — Venmo allows 5-30 chars + dots/underscores, Wise allows
--     emails OR handles, etc.) or too loose to be worth the migration
--     cost when the only writer is our own /api/profile endpoint.
--   - All three columns are nullable — a user may use one, two, three,
--     or zero providers. NULL = "not set, hide this button".
--
-- RLS:
--   - public.users already has RLS; users can SELECT + UPDATE their own
--     row. Trip collaborators can read these specific columns of OTHER
--     users via the existing trip_collaborators-aware policies that the
--     ExpenseLedger / SettleUpView fetch path already uses (it pulls
--     `members` via /api/trips/[id]/members which is collab-gated).
--   - No new RLS policy is required: existing policies cover the read +
--     write paths for payment handle columns the same way they cover
--     display_name and avatar_url.
--
-- ZERO RISK: pure additive ALTER, no defaults that touch existing rows,
-- no constraint that could fail on backfill.

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS paypal_handle TEXT,
ADD COLUMN IF NOT EXISTS venmo_handle TEXT,
ADD COLUMN IF NOT EXISTS wise_handle TEXT;

COMMENT ON COLUMN public.users.paypal_handle IS
'PayPal.me handle for SettleUp deeplinks. Example: "alyssaperez" — produces https://paypal.me/alyssaperez/42EUR. App-layer validates [A-Za-z0-9._-]{3,32}.';

COMMENT ON COLUMN public.users.venmo_handle IS
'Venmo username for SettleUp deeplinks. Example: "alyssa-perez" — produces venmo://paycharge?recipients=alyssa-perez&amount=42. App-layer validates 5-30 chars: letters, digits, dot, dash, underscore.';

COMMENT ON COLUMN public.users.wise_handle IS
'Wise (formerly TransferWise) handle for SettleUp deeplinks. Either a wiseTag (e.g. "@alyssaperez") or the user-visible path segment used by https://wise.com/pay/me/{handle}. App-layer validates [A-Za-z0-9._@-]{3,64}.';
