import type { SessionTripData } from "@/hooks/useSessionTripStack";
import type { KeptPlan } from "@/lib/plans/kept-plan";
import type { TripIntent } from "@/lib/posthog/events";
import type { Diet } from "@/lib/trips/diet";
import type { TripFormState } from "@/lib/trips/persistTrip";
import type { GeneratedItinerary, TripAnchor, TripVibe } from "@/types";

/**
 * The wizard's answers that travel with a plan. A draft, the saved trip and
 * the session tray keep them all, and a kept plan all but the anchors, each
 * built here from the same answers.
 */
export interface WizardAnswers {
  destination: string;
  startDate: string;
  endDate: string;
  pace: "relaxed" | "moderate" | "active";
  vibes: TripVibe[];
  budgetTier: "budget" | "balanced" | "premium";
  travelStyle: "classic" | "backpacker";
  anchors: TripAnchor[];
  mustDos: string[];
  dietary: Diet[];
  tripIntent: TripIntent;
  flexibleDates: boolean;
}

/** The form fields a saved trip is written from (lib/trips/persistTrip.ts). */
export function tripFormState(
  answers: WizardAnswers,
  extra: { derivedInterests: string[]; locale: string }
): TripFormState {
  return { ...answers, ...extra };
}

/** A signed-out planner's kept plan: every answer but the anchors, which it does not hold. */
export function keptPlanOf(answers: WizardAnswers, itinerary: GeneratedItinerary): KeptPlan {
  const { destination, startDate, endDate, pace, vibes, budgetTier, travelStyle, tripIntent, flexibleDates, mustDos, dietary } =
    answers;
  return {
    destination,
    startDate,
    endDate,
    itinerary,
    pace,
    vibes,
    budgetTier,
    travelStyle,
    ...(tripIntent === "solo" || tripIntent === "group" ? { tripIntent } : {}),
    ...(flexibleDates ? { flexibleDates: true } : {}),
    ...(mustDos.length > 0 ? { mustDos } : {}),
    ...(dietary.length > 0 ? { dietary } : {}),
  };
}

/** The session tray's entry for a plan: every answer, so switching back to it brings them all back. */
export function sessionTripOf(answers: WizardAnswers, itinerary: GeneratedItinerary): SessionTripData {
  return { ...answers, dayCount: itinerary.days.length, itinerary };
}
