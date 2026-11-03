"use client";

import { useCallback, useEffect, useRef } from "react";
import { landingAttribution, trackWizardEvent, type WizardEventStep } from "@/components/wizard/wizardEvents";
import { useDwellHeartbeat } from "@/hooks/useDwellHeartbeat";
import { funnelDays, funnelTraits } from "@/lib/wizard/plan-funnel";
import {
  captureTripWizardAbandoned,
  captureTripWizardFieldInteracted,
  captureTripWizardStepViewed,
  type TripIntent,
  type TripWizardFieldInteractedEvent,
} from "@/lib/posthog/events";
import type { TripVibe } from "@/types";

// LOAD-BEARING: declared at module scope so the array identity is stable
// across renders. A new reference per render would recreate
// trackFieldInteraction and handleVibesChange (breaking VibeSelector's
// React.memo, which stalls step-2 vibe clicks) and re-fire the abandonment
// effect, tearing down and re-attaching its window listeners every render.
export const WIZARD_STEP_NAMES = ["destination_dates", "vibes_preferences"] as const;

/**
 * The wizard's funnel, in PostHog and in wizard_step_events: one step view per
 * step and mount, the first touch of each field on a step, a heartbeat while
 * step 1 is open, and one `abandoned` row (how far the session got) when the
 * page goes before the planner generated. `markCompleted` is called when they
 * generate.
 */
export function useWizardFunnel({
  step,
  entryResolved,
  locale,
  tripIntent,
  travelStyle,
  destination,
  startDate,
  endDate,
  vibes,
}: {
  step: number;
  /** The auth state is known: nothing is sent before it. */
  entryResolved: boolean;
  locale: string;
  tripIntent: TripIntent;
  travelStyle: "classic" | "backpacker";
  destination: string;
  startDate: string;
  endDate: string;
  vibes: TripVibe[];
}) {
  // ── Wizard funnel diagnostics ────────────────────────────────────────────
  // These refs + the abandonment listener record how far an abandoning
  // session got (no engagement at all, a destination typed but no dates,
  // etc.) to pinpoint which field on /trips/new loses the funnel.

  const wizardMountedAtRef = useRef<number>(Date.now());
  const lastTouchedFieldRef = useRef<TripWizardFieldInteractedEvent["field"] | null>(null);
  const touchedFieldsThisStepRef = useRef<Set<string>>(new Set());
  const wizardCompletedRef = useRef<boolean>(false);
  const abandonedFiredRef = useRef<boolean>(false);

  // Mirror state into refs so the unload handlers can read current values
  // without having to re-bind the listeners on every state change.
  const stepRef = useRef(step);
  const destinationFieldRef = useRef(destination);
  const startDateRef = useRef(startDate);
  const endDateRef = useRef(endDate);
  const vibesRef = useRef(vibes);

  // The step-view effect re-runs on React 19 dev StrictMode double-mount and
  // on back nav, Start Over and draft-recovery setState. PostHog dedupes
  // server-side but wizard_step_events does not, so without this guard one
  // step view writes several rows and understates funnel conversion. Same
  // ref-guard pattern as abandonedFiredRef and wizardCompletedRef below.
  const trackedStepsRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    // Wait for the auth state before EITHER sink fires. Placed above the
    // PostHog capture too, not just the Supabase mirror: an early pass would
    // otherwise emit a step-view before posthog.register() has attached the
    // wizard_entry super-property, and would emit it twice.
    if (!entryResolved) {
      return;
    }
    captureTripWizardStepViewed({
      step_number: step,
      step_name: WIZARD_STEP_NAMES[step - 1],
    });
    // Mirror the step view into Supabase. Step 1 fires
    // `step_1_destination_dates`, step 2 fires `step_2_vibes`. This is the
    // entry-point event for each step — downstream events (generating/result/
    // save_clicked/saved/abandoned) are fired from their own handlers. Step 1
    // sends only `locale`, the one field guaranteed to be meaningful then.
    //
    // Gate on trackedStepsRef so we fire exactly once per step per wizard
    // mount lifetime: going back to a step (1→2→1) does not re-fire. A full
    // remount (route nav) resets the ref, which is correct — that's a new
    // session view.
    if (trackedStepsRef.current.has(step)) {
      return;
    }
    trackedStepsRef.current.add(step);
    if (step === 1) {
      void trackWizardEvent("step_1_destination_dates", { locale, ...landingAttribution() });
    } else if (step === 2) {
      void trackWizardEvent("step_2_vibes", {
        ...funnelTraits({ destination: destinationFieldRef.current || undefined, tripIntent, travelStyle }),
        duration_days: funnelDays(startDateRef.current, endDateRef.current),
        locale,
      });
    }
    // entryResolved is a REQUIRED dep: it flips false->true once the auth state
    // resolves and that flip is what actually fires the step view.
    // exhaustive-deps is disabled here, so the linter won't catch its removal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, entryResolved]);

  // ── Step-1 dwell heartbeat ───────────────────────────────────────────────
  // Many step-1 abandoners log a single event, so their dwell (bounce in <2s
  // vs deliberate struggle) is unmeasurable. A heartbeat while the session
  // sits on step 1 turns them into a time series; the 10s spacing never
  // collides with the wizard-event sink's 1s dedupe bucket.
  useDwellHeartbeat(step === 1, () => void trackWizardEvent("step1_heartbeat", { locale }));

  useEffect(() => { stepRef.current = step; }, [step]);
  useEffect(() => { destinationFieldRef.current = destination; }, [destination]);
  useEffect(() => { startDateRef.current = startDate; }, [startDate]);
  useEffect(() => { endDateRef.current = endDate; }, [endDate]);
  useEffect(() => { vibesRef.current = vibes; }, [vibes]);

  // Reset per-step tracking when the user advances/retreats
  useEffect(() => {
    lastTouchedFieldRef.current = null;
    touchedFieldsThisStepRef.current = new Set();
  }, [step]);

  /**
   * Record a field interaction. Emits trip_wizard_field_interacted on first
   * touch only (don't flood PostHog) and updates the last-touched ref so
   * the abandonment event can name the field they bailed on.
   */
  const trackFieldInteraction = useCallback(
    (field: TripWizardFieldInteractedEvent["field"]) => {
      lastTouchedFieldRef.current = field;
      const firstTouch = !touchedFieldsThisStepRef.current.has(field);
      if (firstTouch) {
        touchedFieldsThisStepRef.current.add(field);
        captureTripWizardFieldInteracted({
          step_number: stepRef.current,
          step_name: WIZARD_STEP_NAMES[stepRef.current - 1],
          field,
          first_touch: true,
        });
      }
    },
    []
  );

  // Abandonment listener: fire trip_wizard_abandoned exactly once when the
  // user closes the tab, navigates away, or the wizard component unmounts —
  // unless they completed the flow (markCompleted, which handleGenerate calls).
  useEffect(() => {
    function fireAbandoned() {
      if (abandonedFiredRef.current || wizardCompletedRef.current) return;
      // Only fire if they actually engaged (touched ≥ 1 field). Otherwise
      // we'd flood PostHog with bot/preview pageviews.
      if (touchedFieldsThisStepRef.current.size === 0 && stepRef.current === 1) {
        return;
      }
      abandonedFiredRef.current = true;
      const totalSeconds = Math.round((Date.now() - wizardMountedAtRef.current) / 1000);
      captureTripWizardAbandoned({
        last_step_completed: Math.max(0, stepRef.current - 1),
        last_step_name: WIZARD_STEP_NAMES[stepRef.current - 1],
        total_time_seconds: totalSeconds,
        last_touched_field: lastTouchedFieldRef.current,
        had_destination: Boolean(destinationFieldRef.current),
        had_dates: Boolean(startDateRef.current && endDateRef.current),
        had_vibes: vibesRef.current.length > 0,
      });
      // Supabase funnel mirror — terminal `abandoned` state. We use
      // the same step-name vocabulary as the other wizard events so
      // SQL funnel queries can self-join the table on
      // (session_id, step) without name translation.
      // keepalive=true on the fetch is what makes this survive the
      // beforeunload / pagehide path on most browsers.
      const lastStepName: WizardEventStep =
        stepRef.current === 1
          ? "step_1_destination_dates"
          : "step_2_vibes";
      void trackWizardEvent("abandoned", {
        destination: destinationFieldRef.current || undefined,
        duration_days: funnelDays(startDateRef.current, endDateRef.current),
        locale,
        // Surface the last in-wizard step the user reached, plus the
        // last field they touched, so we can answer "which field did
        // people quit on?" in SQL the same way we already can in
        // PostHog.
        last_step: lastStepName,
        last_touched_field: lastTouchedFieldRef.current ?? undefined,
        total_time_seconds: totalSeconds,
      });
    }

    function handleVisibility() {
      if (document.visibilityState === "hidden") fireAbandoned();
    }

    window.addEventListener("beforeunload", fireAbandoned);
    window.addEventListener("pagehide", fireAbandoned);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      // Fire on SPA unmount too (router.push elsewhere mid-wizard)
      fireAbandoned();
      window.removeEventListener("beforeunload", fireAbandoned);
      window.removeEventListener("pagehide", fireAbandoned);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [locale]);

  const markCompleted = useCallback(() => {
    wizardCompletedRef.current = true;
  }, []);

  return { trackFieldInteraction, markCompleted };
}
