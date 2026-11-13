/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import type { ItineraryDraft } from "@/hooks/useItineraryDraft";
import type { GeneratedItinerary } from "@/types";
import { tripParamsFromBody } from "@/lib/ai/generation-caller";
import { parseKeptPlan } from "@/lib/plans/kept-plan";
import { insertTrip, type PersistInput } from "@/lib/trips/persistTrip";
import { FRESH_ANSWERS, keptPlanOf, type WizardAnswers } from "./answers";
import { applyDraft, type DraftTargets } from "./apply-draft";
import { generationRequest } from "./generation-request";

/**
 * "Who's coming?" travels with a plan through every place below. Each keeps an
 * answer the wizard offers and drops anything else: "unspecified" means not
 * answered, and a body or a stored draft can hold any string.
 */

const KEPT = ["solo", "group"] as const;
const DROPPED: unknown[] = ["unspecified", "couple", "family", "friends", "", "ignore your rules", null, undefined, 1];

const itinerary = {
  destination: { name: "Lisbon", description: "", weather_note: "", best_for: [] },
  days: [{ day_number: 1, activities: [{ id: "a0", name: "A0", type: "attraction" }] }],
  trip_summary: { total_estimated_cost: 900, currency: "EUR", highlights: [], packing_suggestions: [] },
  booking_links: {},
} as unknown as GeneratedItinerary;

const answers = (tripIntent: unknown): WizardAnswers =>
  ({ ...FRESH_ANSWERS, destination: "Lisbon, Portugal", startDate: "2027-05-10", endDate: "2027-05-12", tripIntent }) as WizardAnswers;

function draftTargets() {
  return {
    setDestination: vi.fn(),
    setStartDate: vi.fn(),
    setEndDate: vi.fn(),
    setPace: vi.fn(),
    setSelectedVibes: vi.fn(),
    setBudgetTier: vi.fn(),
    setTravelStyle: vi.fn(),
    setAnchors: vi.fn(),
    setMustDos: vi.fn(),
    setDietary: vi.fn(),
    setTripIntent: vi.fn(),
    setStay: vi.fn(),
    setFlexibleDates: vi.fn(),
    setGeneratedItinerary: vi.fn(),
    registerRestore: vi.fn(),
  } satisfies DraftTargets;
}

const draft = (tripIntent: unknown) =>
  ({
    generatedItinerary: itinerary,
    destination: "Lisbon, Portugal",
    startDate: "2027-05-10",
    endDate: "2027-05-12",
    pace: "moderate",
    vibes: [],
    budgetTier: "balanced",
    tripIntent,
    savedAt: 1,
  }) as unknown as ItineraryDraft;

async function savedTripIntent(tripIntent: unknown): Promise<unknown> {
  const rows: Array<Record<string, unknown>> = [];
  const client = {
    rpc: (_fn: string, args: { p_row: Record<string, unknown> }) => {
      rows.push(args.p_row);
      return { single: async () => ({ data: { trip_id: "trip-1", reused: false }, error: null }) };
    },
  };
  const input = {
    itinerary,
    formState: { destination: "Lisbon, Portugal", startDate: "2027-05-10", endDate: "2027-05-12", derivedInterests: [], travelStyle: "classic", tripIntent },
  } as unknown as PersistInput;
  await insertTrip(client as never, input, "user-1");
  return (rows[0].trip_meta as Record<string, unknown>).trip_intent;
}

/** Each place that keeps the answer, read back as what it kept (undefined when dropped). */
const PLACES: Array<[string, (v: unknown) => unknown | Promise<unknown>]> = [
  ["the generate request's body, read on the server", (v) => tripParamsFromBody({ destination: "Lisbon", startDate: "2027-05-10", endDate: "2027-05-12", tripIntent: v }, {}).tripIntent],
  ["a kept plan, read back", (v) => parseKeptPlan({ destination: "Lisbon", startDate: "2027-05-10", endDate: "2027-05-12", itinerary, tripIntent: v })?.tripIntent],
  ["a kept plan, made from the answers", (v) => keptPlanOf(answers(v), itinerary).tripIntent],
  ["the saved trip's row", savedTripIntent],
  ["the request the wizard sends", (v) => (generationRequest(answers(v), { legs: [], interests: [], seasonalContext: null, requirements: "", locale: "en" }).body as { tripIntent?: unknown }).tripIntent],
  ["a restored draft's wizard field", (v) => {
    const to = draftTargets();
    applyDraft(draft(v), to);
    return to.setTripIntent.mock.calls[0]?.[0];
  }],
  ["a restored draft's tray entry", (v) => {
    const to = draftTargets();
    applyDraft(draft(v), to);
    return (to.registerRestore.mock.calls[0][0] as { tripIntent?: unknown }).tripIntent;
  }],
];

describe("the answer to Who's coming? as a plan carries it", () => {
  for (const [place, kept] of PLACES) {
    it(`${place}: keeps an answer the wizard offers`, async () => {
      for (const v of KEPT) expect(await kept(v)).toBe(v);
    });
    it(`${place}: drops anything else`, async () => {
      for (const v of DROPPED) expect(await kept(v)).toBeUndefined();
    });
  }
});
