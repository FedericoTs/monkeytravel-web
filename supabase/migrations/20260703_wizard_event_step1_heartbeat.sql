-- UX10X Master Plan Phase 0.3 — step-1 dwell heartbeat.
--
-- Adds 'step1_heartbeat' to the wizard_step_events.step CHECK. The wizard
-- fires this event every 10s while a session sits on step 1. Rationale:
-- forensics showed 56% of anonymous step-1 abandoner sessions log exactly
-- ONE event, so their dwell time (a <2s bounce vs a deliberate multi-second
-- struggle) is structurally unmeasurable. Heartbeats turn single-event
-- sessions into a measurable time series without changing any existing step.
--
-- The step vocabulary is duplicated in THREE places that must stay in lockstep:
--   1. WizardEventStep union       — components/wizard/wizardEvents.ts
--   2. STEP_VALUES zod enum         — app/api/wizard-event/route.ts
--   3. this CHECK constraint        — here
-- Modeled on 20260630_wizard_event_front_door.sql.
--
-- Applied to prod (sevfbahwmlbdlnbhqwyi) 2026-07-03 via MCP apply_migration.

ALTER TABLE public.wizard_step_events
  DROP CONSTRAINT wizard_step_events_step_check;

ALTER TABLE public.wizard_step_events
  ADD CONSTRAINT wizard_step_events_step_check CHECK (
    step = ANY (ARRAY[
      'step_1_destination_dates'::text,
      'step1_heartbeat'::text,
      'step_2_vibes'::text,
      'generating'::text,
      'result'::text,
      'options_requested'::text,
      'options_shown'::text,
      'first_value'::text,
      'save_clicked'::text,
      'save_blocked_anon'::text,
      'save_failed'::text,
      'saved'::text,
      'abandoned'::text
    ])
  );
