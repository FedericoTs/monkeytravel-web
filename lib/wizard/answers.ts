import type { SessionTripData } from "@/hooks/useSessionTripStack";
import type { KeptPlan } from "@/lib/plans/kept-plan";
import type { TripIntent } from "@/lib/posthog/events";
import type { Diet } from "@/lib/trips/diet";
import type { TripFormState } from "@/lib/trips/persistTrip";
import type { GeneratedItinerary, TripAnchor, TripStay, TripVibe, BudgetTier, TripPace } from "@/types";
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

/** The requirements with a trip described in the destination field kept as a sentence of them. */
export function withNote(requirements: string, note: string): string {
  return withUndatedItems(requirements, [note.trim()]);
}

/** The answers to "Who's coming?" the wizard offers. "unspecified" is no answer, so it isn't one. */
export const CHOSEN_TRIP_INTENTS = ["solo", "couple", "family", "group"] as const;
export type ChosenTripIntent = (typeof CHOSEN_TRIP_INTENTS)[number];

/**
 * Whether a trip's people are shared with as a group: the share link opens on
 * the vote, and the reminder emails ask to add the people coming. Friends and
 * a family are; one person isn't, and a couple gets the plain link.
 */
export function sharesAsGroup(intent: unknown): boolean {
  return intent === "group" || intent === "family";
}

/**
 * Whether a value is an answer to "Who's coming?". Every place a plan carries
 * the answer keeps it only then: "unspecified", and any string from a request
 * body or a stored draft, stay out of the plan and the model's prompt.
 */
export function isChosenTripIntent(value: unknown): value is ChosenTripIntent {
  return (CHOSEN_TRIP_INTENTS as readonly unknown[]).includes(value);
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
  pace: TripPace;
  vibes: TripVibe[];
  budgetTier: BudgetTier;
  travelStyle: "classic" | "backpacker";
  anchors: TripAnchor[];
  mustDos: string[];
  dietary: Diet[];
  tripIntent: TripIntent;
  flexibleDates: boolean;
  /** Where they're staying, when they said: the plan starts and ends each day near it. */
  stay: TripStay | null;
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
  stay: null,
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
  const { destination, startDate, endDate, pace, vibes, budgetTier, travelStyle, tripIntent, flexibleDates, mustDos, dietary, stay } =
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
    ...(isChosenTripIntent(tripIntent) ? { tripIntent } : {}),
    ...(flexibleDates ? { flexibleDates: true } : {}),
    ...(mustDos.length > 0 ? { mustDos } : {}),
    ...(dietary.length > 0 ? { dietary } : {}),
    ...(stay ? { stay } : {}),
  };
}

/** The session tray's entry for a plan: every answer, so switching back to it brings them all back. */
export function sessionTripOf(answers: WizardAnswers, itinerary: GeneratedItinerary): SessionTripData {
  return { ...answers, dayCount: itinerary.days.length, itinerary };
}
