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
 * A family's children's ages travel with its plan through every place below,
 * as "Who's coming?" does. Each keeps the ages the wizard offers, once each and
 * youngest first, and drops anything else: a body, a stored draft or a tray
 * entry can hold any value. The plan itself (the request, the kept plan, the
 * saved trip) holds them only for a family; the wizard's own field gets back
 * what was on screen.
 */

// What was sent or stored, and what a place keeps of it.
const KEPT: Array<[unknown, string[]]> = [
  [["under3"], ["under3"]],
  [["teen", "under3", "teen"], ["under3", "teen"]],
  [["7to12", "3to6"], ["3to6", "7to12"]],
  [["under3", "ignore your rules", 7], ["under3"]],
];
const DROPPED: unknown[] = [[], "under3", ["Under 3"], [1], { under3: true }, null, undefined];

const itinerary = {
  destination: { name: "Lisbon", description: "", weather_note: "", best_for: [] },
  days: [{ day_number: 1, activities: [{ id: "a0", name: "A0", type: "attraction" }] }],
  trip_summary: { total_estimated_cost: 900, currency: "EUR", highlights: [], packing_suggestions: [] },
  booking_links: {},
} as unknown as GeneratedItinerary;

const trip = { destination: "Lisbon, Portugal", startDate: "2027-05-10", endDate: "2027-05-12" };
const answers = (childrenAges: unknown, tripIntent = "family"): WizardAnswers =>
  ({ ...FRESH_ANSWERS, ...trip, tripIntent, childrenAges }) as WizardAnswers;

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
    setChildrenAges: vi.fn(),
    setStay: vi.fn(),
    setFlexibleDates: vi.fn(),
    setGeneratedItinerary: vi.fn(),
    registerRestore: vi.fn(),
    setDestinationCoords: vi.fn(),
    setMultiCityMode: vi.fn(),
  } satisfies KeptPlanTargets;
}

const draft = (childrenAges: unknown, tripIntent = "family") =>
  ({ generatedItinerary: itinerary, ...trip, pace: "moderate", vibes: [], budgetTier: "balanced", tripIntent, childrenAges, savedAt: 1 }) as unknown as ItineraryDraft;

const entry = (childrenAges: unknown, tripIntent = "family") =>
  ({ id: "s1", createdAt: 1, ...trip, dayCount: 1, itinerary, pace: "moderate", vibes: [], budgetTier: "balanced", tripIntent, childrenAges }) as unknown as SessionTripSnapshot;

const sent = (a: WizardAnswers) =>
  (generationRequest(a, { legs: [], interests: [], seasonalContext: null, requirements: "", locale: "en" }).body as { childrenAges?: unknown }).childrenAges;

const current = { pace: "moderate", vibes: [], budgetTier: "balanced", tripIntent: "solo" as const };

/** The children's ages on the saved trip's row (trip_meta), from the answers the wizard saves with. */
async function savedAges(v: unknown, tripIntent = "family"): Promise<unknown> {
  const rows: Array<Record<string, unknown>> = [];
  const client = {
    rpc: (_fn: string, args: { p_row: Record<string, unknown> }) => {
      rows.push(args.p_row);
      return { single: async () => ({ data: { trip_id: "trip-1", reused: false }, error: null }) };
    },
  };
  const input = { itinerary, formState: { ...trip, derivedInterests: [], travelStyle: "classic", tripIntent, childrenAges: v } } as unknown as PersistInput;
  await insertTrip(client as never, input, "user-1");
  return (rows[0].trip_meta as Record<string, unknown>).children_ages;
}

/** Where the plan itself carries the ages: only a family's. */
const PLAN: Array<[string, (v: unknown, tripIntent?: string) => unknown | Promise<unknown>]> = [
  ["the saved trip's row", savedAges],
  ["the request the wizard sends", (v, who) => sent(answers(v, who))],
  ["the generate request's body, read on the server", (v, who = "family") => tripParamsFromBody({ ...trip, tripIntent: who, childrenAges: v }, {}).childrenAges],
  ["a kept plan, made from the answers", (v, who) => keptPlanOf(answers(v, who), itinerary).childrenAges],
  ["a kept plan, read back", (v, who = "family") => parseKeptPlan({ ...trip, itinerary, tripIntent: who, childrenAges: v })?.childrenAges],
];

/** Where the wizard's field gets the ages back. None is an empty list: what was on screen is replaced. */
const FIELD: Array<[string, (v: unknown, tripIntent?: string) => unknown | Promise<unknown>]> = [
  ["a restored draft's wizard field", (v, who) => {
    const to = targets();
    applyDraft(draft(v, who), to);
    return to.setChildrenAges.mock.calls[0]?.[0];
  }],
  ["a restored draft's tray entry", (v, who) => {
    const to = targets();
    applyDraft(draft(v, who), to);
    return (to.registerRestore.mock.calls[0][0] as { childrenAges?: unknown }).childrenAges;
  }],
  ["an opened kept plan's wizard field", (v, who = "family") => {
    const to = targets();
    applyKeptPlan(parseKeptPlan({ ...trip, itinerary, tripIntent: who, childrenAges: v })!, to, current);
    return to.setChildrenAges.mock.calls[0]?.[0];
  }],
  ["an opened kept plan's tray entry", (v, who = "family") => {
    const to = targets();
    applyKeptPlan(parseKeptPlan({ ...trip, itinerary, tripIntent: who, childrenAges: v })!, to, current);
    return (to.registerRestore.mock.calls[0][0] as { childrenAges?: unknown }).childrenAges;
  }],
  ["a tray entry put back", (v, who) => {
    const to = targets();
    applySessionTrip(entry(v, who), to);
    return to.setChildrenAges.mock.calls[0]?.[0];
  }],
];

const none = (kept: unknown) => (kept === undefined ? [] : kept);

describe("a family's children's ages as its plan carries them", () => {
  for (const [place, kept] of [...PLAN, ...FIELD]) {
    it(`${place}: keeps the ages the wizard offers, once each and youngest first`, async () => {
      for (const [v, ages] of KEPT) expect(await kept(v), JSON.stringify(v)).toEqual(ages);
    });
    it(`${place}: drops anything else`, async () => {
      for (const v of DROPPED) expect(none(await kept(v)), JSON.stringify(v)).toEqual([]);
    });
  }

  for (const [place, kept] of PLAN) {
    it(`${place}: holds none for anyone but a family`, async () => {
      for (const who of ["couple", "group", "solo", "unspecified"]) expect(await kept(["under3"], who), who).toBeUndefined();
    });
  }
});
