/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import type { ItineraryDraft } from "@/hooks/useItineraryDraft";
import type { SessionTripSnapshot } from "@/hooks/useSessionTripStack";
import type { GeneratedItinerary } from "@/types";
import { tripParamsFromBody } from "@/lib/ai/generation-caller";
import { parseKeptPlan } from "@/lib/plans/kept-plan";
import { insertTrip, type PersistInput } from "@/lib/trips/persistTrip";
import { FRESH_ANSWERS, keptPlanOf, type WizardAnswers } from "./answers";
import { applyDraft, applyKeptPlan, applySessionTrip, type KeptPlanTargets } from "./apply-draft";
import { generationRequest } from "./generation-request";

/**
 * When they arrive and leave travels with the plan through every place below, as "Who's coming?" does: each keeps
 * the answers step 2 offers and drops anything else, since a body, a stored draft or a tray entry can hold any value.
 */

const trip = { destination: "Rome, Italy", startDate: "2027-04-10", endDate: "2027-04-13" };
const KEPT: Array<[unknown, unknown, { arrival?: string; departure?: string }]> = [
  ["evening", "morning", { arrival: "evening", departure: "morning" }],
  ["night", undefined, { arrival: "night" }],
  [undefined, "afternoon", { departure: "afternoon" }],
  ["morning", "night", { arrival: "morning" }],
];
const DROPPED: Array<[unknown, unknown]> = [
  ["Evening", "MORNING"],
  ["at 8pm", "18:00"],
  [["evening"], { when: "morning" }],
  [null, null],
  [undefined, undefined],
];

const itinerary = {
  destination: { name: "Rome", description: "", weather_note: "", best_for: [] },
  days: [{ day_number: 1, activities: [{ id: "a0", name: "A0", type: "attraction" }] }],
  trip_summary: { total_estimated_cost: 900, currency: "EUR", highlights: [], packing_suggestions: [] },
  booking_links: {},
} as unknown as GeneratedItinerary;

const answers = (arrival: unknown, departure: unknown): WizardAnswers => ({ ...FRESH_ANSWERS, ...trip, arrival, departure }) as WizardAnswers;
const stored = (arrival: unknown, departure: unknown) => ({ ...trip, arrival, departure });

function targets() {
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
    setArrival: vi.fn(),
    setDeparture: vi.fn(),
    setStay: vi.fn(),
    setFlexibleDates: vi.fn(),
    setGeneratedItinerary: vi.fn(),
    registerRestore: vi.fn(),
    setDestinationCoords: vi.fn(),
    setMultiCityMode: vi.fn(),
  } satisfies KeptPlanTargets;
}
const current = { pace: "moderate", vibes: [], budgetTier: "balanced", tripIntent: "solo" as const };

/** Only the two answers, as a place holds them. */
const pair = (v: { arrival?: unknown; departure?: unknown } | null | undefined) => ({
  ...(v?.arrival ? { arrival: v.arrival } : {}),
  ...(v?.departure ? { departure: v.departure } : {}),
});
const fields = (to: ReturnType<typeof targets>) =>
  pair({ arrival: to.setArrival.mock.calls[0]?.[0], departure: to.setDeparture.mock.calls[0]?.[0] });

async function saved(arrival: unknown, departure: unknown) {
  const rows: Array<Record<string, unknown>> = [];
  const client = {
    rpc: (_fn: string, args: { p_row: Record<string, unknown> }) => {
      rows.push(args.p_row);
      return { single: async () => ({ data: { trip_id: "trip-1", reused: false }, error: null }) };
    },
  };
  const input = { itinerary, formState: { ...trip, derivedInterests: [], travelStyle: "classic", arrival, departure } } as unknown as PersistInput;
  await insertTrip(client as never, input, "user-1");
  return pair(rows[0].trip_meta as Record<string, unknown>);
}

const PLACES: Array<[string, (a: unknown, d: unknown) => unknown]> = [
  ["the request the wizard sends", (a, d) => pair(generationRequest(answers(a, d), { legs: [], interests: [], seasonalContext: null, requirements: "", locale: "en" }).body)],
  ["a kept plan, made from the answers", (a, d) => pair(keptPlanOf(answers(a, d), itinerary))],
  ["a kept plan, read back", (a, d) => pair(parseKeptPlan({ ...stored(a, d), itinerary }))],
  ["the saved trip's row", saved],
  ["a restored draft's wizard fields", (a, d) => {
    const to = targets();
    applyDraft({ generatedItinerary: itinerary, pace: "moderate", vibes: [], budgetTier: "balanced", savedAt: 1, ...stored(a, d) } as unknown as ItineraryDraft, to);
    return fields(to);
  }],
  ["a restored draft's tray entry", (a, d) => {
    const to = targets();
    applyDraft({ generatedItinerary: itinerary, pace: "moderate", vibes: [], budgetTier: "balanced", savedAt: 1, ...stored(a, d) } as unknown as ItineraryDraft, to);
    return pair(to.registerRestore.mock.calls[0][0]);
  }],
  ["an opened kept plan's wizard fields", (a, d) => {
    const to = targets();
    applyKeptPlan(parseKeptPlan({ ...stored(a, d), itinerary })!, to, current);
    return fields(to);
  }],
  ["a tray entry put back", (a, d) => {
    const to = targets();
    applySessionTrip({ id: "s1", createdAt: 1, dayCount: 1, itinerary, pace: "moderate", vibes: [], budgetTier: "balanced", ...stored(a, d) } as unknown as SessionTripSnapshot, to);
    return fields(to);
  }],
];

describe("when they arrive and leave, as the plan carries it", () => {
  for (const [place, keeps] of PLACES) {
    it(`${place}: keeps the answers step 2 offers`, async () => {
      for (const [a, d, want] of KEPT) expect(await keeps(a, d), `${a} ${d}`).toEqual(want);
    });
    it(`${place}: drops anything else`, async () => {
      for (const [a, d] of DROPPED) expect(await keeps(a, d), `${JSON.stringify(a)} ${JSON.stringify(d)}`).toEqual({});
    });
  }

  it("the server puts them on the trip's own first and last dates", () => {
    const body = generationRequest(answers("evening", "morning"), { legs: [], interests: [], seasonalContext: null, requirements: "", locale: "en" }).body;
    const read = tripParamsFromBody({ ...body }, {});
    expect(read.arrival).toEqual({ when: "evening", date: "2027-04-10" });
    expect(read.departure).toEqual({ when: "morning", date: "2027-04-13" });
  });
});
