import type { SessionTripData } from "@/hooks/useSessionTripStack";
import type { KeptPlan } from "@/lib/plans/kept-plan";
import type { TripIntent } from "@/lib/posthog/events";
import type { Diet } from "@/lib/trips/diet";
import type { TripFormState } from "@/lib/trips/persistTrip";
import type { GeneratedItinerary, TripAnchor, TripVibe } from "@/types";
import { REQUIREMENTS_MAX } from "@/lib/trips/request-limits";

/**
 * The requirements with the pasted plan items that have no day added as
 * sentences: they can't be fixed plans, but they are still the traveller's
 * plan, so generation should honour them. Clamped to REQUIREMENTS_MAX, since
 * the requirements field sits in a folded section and an unclamped paste would
 * fail every generate with the overflow out of sight.
 */
export function withUndatedItems(requirements: string, items: string[]): string {
  const addition = items.join(". ");
  const merged = requirements.trim() ? `${requirements.trim()}. ${addition}` : addition;
  return merged.slice(0, REQUIREMENTS_MAX);
}

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

/** A fresh wizard's answers, which Start Over puts back. */
export const FRESH_ANSWERS: WizardAnswers = {
  destination: "",
  startDate: "",
  endDate: "",
  pace: "moderate",
  vibes: [],
  budgetTier: "balanced",
  travelStyle: "classic",
  anchors: [],
  mustDos: [],
  dietary: [],
  tripIntent: "unspecified",
  flexibleDates: false,
};

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
