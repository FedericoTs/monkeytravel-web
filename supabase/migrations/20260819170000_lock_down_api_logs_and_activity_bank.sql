-- Close the last two anon-writable tables from the 2026-08-19 drift audit.
--
-- ⚠️ Apply only AFTER 6ab3370 is live. That commit moved both writers off the
-- cookie-scoped client (which resolves to anon for anonymous traffic) and onto
-- the service role. Unlike geocode_cache/distance_cache — which held 0 rows and
-- whose APIs are disabled — BOTH of these are actively written:
-- api_request_logs had 17,652 rows and is written on every API call;
-- destination_activity_bank holds 209. Applying this first would have blinded
-- API cost logging and broken the activity bank.
--
-- WHAT WAS OPEN
--   api_request_logs           api_request_logs_insert                 INSERT WITH CHECK (true)
--   destination_activity_bank  ..._insert_consolidated                 INSERT WITH CHECK (true)
--   destination_activity_bank  ..._update_consolidated                 UPDATE USING/CHECK (true)
--
-- WHY EACH WAS REACHABLE BY ANON, AND WHY THAT WAS ACCIDENTAL
-- Neither is user data. api_request_logs is pure server telemetry — user_id is
-- set explicitly on the row, never derived from the caller session. The
-- activity bank is a GLOBAL pool of AI-generated activities keyed by
-- destination hash. Both simply used the caller's client because that was the
-- convenient import, and the anon grant existed to make that work. Once the
-- writes moved to the service role, the grant had no remaining purpose.
--
-- IMPACT THIS CLOSES
--   destination_activity_bank — anyone could insert or rewrite activity content
--   that is then served into other users' itineraries. Same class as the places
--   cache, and the most user-visible of the two.
--   api_request_logs — anyone could forge cost and usage rows. Not user-facing,
--   but it is the table the cost dashboards and API-spend decisions are read
--   from, so polluted data quietly corrupts the numbers those decisions rest on.
--
-- Reads are left alone: api_request_logs keeps api_request_logs_authenticated_select,
-- the activity bank keeps destination_activity_bank_select_consolidated, and its
-- service_role-only DELETE policy is untouched.
--
-- Verified before applying, on the new deploy and while anon still held its
-- grant: two live /api/places calls produced two api_request_logs rows
-- (14:39:26), proving the service-role logging path works. Any post-migration
-- logging failure is therefore attributable, not ambiguous.

-- ── api_request_logs ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS api_request_logs_insert ON public.api_request_logs;

REVOKE INSERT, UPDATE, DELETE ON public.api_request_logs FROM anon, authenticated;

COMMENT ON TABLE public.api_request_logs IS
  'API cost/usage telemetry. SERVER-WRITE-ONLY: written only via the service '
  'role (lib/api-gateway/api-control.ts). anon previously held a WITH CHECK '
  '(true) INSERT, allowing forged cost rows in the table the spend dashboards '
  'are read from.';

-- ── destination_activity_bank ─────────────────────────────────────────────
DROP POLICY IF EXISTS destination_activity_bank_insert_consolidated ON public.destination_activity_bank;
DROP POLICY IF EXISTS destination_activity_bank_update_consolidated ON public.destination_activity_bank;

REVOKE INSERT, UPDATE, DELETE ON public.destination_activity_bank FROM anon, authenticated;

COMMENT ON TABLE public.destination_activity_bank IS
  'Global AI activity pool keyed by destination hash. SERVER-WRITE-ONLY: '
  'written only via the service role (lib/activity-bank/index.ts). anon '
  'previously held INSERT and UPDATE with WITH CHECK (true), which allowed '
  'poisoning activity content served into other users itineraries.';
