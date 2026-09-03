-- The in-tab code redemption, as two funnel steps.
--
-- WHY
-- ---
-- Measured 2026-09-03 over 30 days, people who started a sign-up:
--
--     Google  (stays in the tab)         96 started, 95 got in   99.0%
--     Magic link (leaves for the mail)   46 started, 29 got in   63.0%
--
-- p = 1.8e-9. The same mechanism by device, among sessions that clicked Save
-- on a finished itinerary: desktop reaches a trip 67.8% of the time, mobile
-- 39.2% (p = 0.0001) — while the CLICK rates are identical (20.5% / 22.1%).
-- Mobile planners want the trip just as much; they are more exposed to
-- "leave the browser and come back somewhere else". 17 people a month ask
-- for a magic link and never get in.
--
-- The six-digit code was already reaching the Send Email hook on every auth
-- email, and AuthAction already printed it. What was missing: ConfirmSignup
-- (what NEW addresses get) carried no token, and nothing in the app accepted
-- one. Both are fixed alongside this migration.
--
-- TWO STEPS, NOT ONE
-- ------------------
-- `otp_code_submitted` is "typed a code and pressed Verify".
-- `otp_code_verified` is "it worked".
--
-- Splitting them is the point: with a single step, a code that fails to
-- redeem looks exactly like a person who walked away, which is the ambiguity
-- that made this leak invisible for months. The gap between the two is the
-- redemption failure rate, and it is the number to watch after this ships.
--
-- Third of the three places this vocabulary lives — the others are the
-- WizardEventStep union in components/wizard/wizardEvents.ts and the zod
-- enum in app/api/wizard-event/route.ts. A value missing from any one of them
-- fails differently: the union is a type error, the zod enum silently 400s,
-- and this CHECK makes the insert fail with a non-23505 error the route does
-- NOT swallow as a dedupe — so it surfaces as a 500 rather than a silent drop.

ALTER TABLE public.wizard_step_events
  DROP CONSTRAINT IF EXISTS wizard_step_events_step_check;

ALTER TABLE public.wizard_step_events
  ADD CONSTRAINT wizard_step_events_step_check
  CHECK (step IN (
    'step_1_destination_dates',
    'step1_heartbeat',
    'step_2_vibes',
    'generating',
    'result',
    'options_requested',
    'options_shown',
    'first_value',
    'save_clicked',
    'save_blocked_anon',
    'save_failed',
    'saved',
    'abandoned',
    'draft_restored',
    'draft_expired',
    'generation_failed',
    'auth_modal_shown',
    'otp_requested',
    'otp_link_opened',
    'otp_code_submitted',
    'otp_code_verified'
  ));
