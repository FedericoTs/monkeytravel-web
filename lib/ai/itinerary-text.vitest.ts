import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GeneratedItinerary, TripCreationParams } from "@/types";
import { ensureTripSummary, parseStreamedItinerary, tryRepairTruncatedJSON } from "./itinerary-text";

vi.mock("@sentry/nextjs", () => ({ addBreadcrumb: vi.fn() }));
beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

const plan = {
  destination: { name: "Lisbon", country: "Portugal", description: "", best_for: [], weather_note: "" },
  days: [
    { day_number: 1, date: "2099-08-11", theme: "Old town", activities: [{ name: "Belém Tower", coordinates: { lat: 38.69, lng: -9.21 } }] },
    { day_number: 2, date: "2099-08-12", theme: "Hills", activities: [{ name: "Alfama walk", description: "Up through the lanes to the castle" }] },
  ],
  trip_summary: { total_estimated_cost: 400, currency: "EUR", highlights: ["Trams"], packing_suggestions: [] },
};
const full = JSON.stringify(plan);
// The reply as the model leaves it when it runs out of tokens mid-description.
const cutOff = full.slice(0, full.indexOf("to the castle"));
const params = { destination: "Lisbon", startDate: "2099-08-11", endDate: "2099-08-12" } as TripCreationParams;

describe("tryRepairTruncatedJSON", () => {
  it("closes a reply cut off mid-string so it parses, keeping what was written", () => {
    const repaired = JSON.parse(tryRepairTruncatedJSON(cutOff)!);
    expect(repaired.days).toHaveLength(2);
    expect(repaired.days[1].activities[0].description).toBe("Up through the lanes"); // the reply is trimmed first
  });

  it("drops a dangling comma or a key without its value", () => {
    expect(JSON.parse(tryRepairTruncatedJSON('{"days": [1, 2,')!)).toEqual({ days: [1, 2] });
    expect(JSON.parse(tryRepairTruncatedJSON('{"a": 1, "b"')!)).toEqual({ a: 1 });
  });

  it("takes off markdown fences", () => {
    expect(JSON.parse(tryRepairTruncatedJSON('```json\n{"a": [1')!)).toEqual({ a: [1] });
  });

  it("leaves alone what it can't safely repair", () => {
    expect(tryRepairTruncatedJSON(full)).toBeNull(); // balanced: the problem is elsewhere
    expect(tryRepairTruncatedJSON('{"a": [1}')).toBeNull(); // mismatched
    expect(tryRepairTruncatedJSON("   ")).toBeNull();
  });
});

describe("ensureTripSummary", () => {
  it("fills a missing summary with safe defaults, in place", () => {
    const itinerary = { days: [] } as unknown as GeneratedItinerary;
    expect(ensureTripSummary(itinerary)).toBe(itinerary);
    expect(itinerary.trip_summary).toEqual({ total_estimated_cost: 0, currency: "USD", highlights: [], packing_suggestions: [] });
  });

  it("keeps the parts that are there and replaces the ones of the wrong kind", () => {
    const itinerary = { trip_summary: { total_estimated_cost: "lots", currency: "EUR", highlights: ["Trams"] } } as unknown as GeneratedItinerary;
    expect(ensureTripSummary(itinerary).trip_summary).toEqual({ total_estimated_cost: 0, currency: "EUR", highlights: ["Trams"], packing_suggestions: [] });
  });
});

describe("parseStreamedItinerary", () => {
  it("repairs a stream cut off mid-reply and finishes it like a whole one", () => {
    const out = parseStreamedItinerary(cutOff, params);
    expect(out.days).toHaveLength(2);
    expect(out.days[1].activities[0].coordinates).toBeDefined(); // given a point
    // The cut came before the summary, so it is backfilled.
    expect(out.trip_summary).toEqual({ total_estimated_cost: 0, currency: "USD", highlights: [], packing_suggestions: [] });
  });

  // A slip mid-reply sent the traveller a second plan, a different one, after the first had streamed in.
  it("mends a quote left unescaped and a comma left out, and keeps the plan as written", () => {
    // Quotes the model didn't escape, and the comma between the days left out.
    const slipped = full
      .replace("Up through the lanes to the castle", 'Up the "Escadinhas" to the castle')
      .replace('},{"day_number":2', '}{"day_number":2');
    expect(() => JSON.parse(slipped)).toThrow(SyntaxError);
    const out = parseStreamedItinerary(slipped, params);
    expect(out.days).toHaveLength(2);
    expect(out.days[1].activities[0].description).toBe('Up the "Escadinhas" to the castle');
    expect(out.trip_summary.total_estimated_cost).toBe(400);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("mended 3 slip(s)"));
  });

  it("throws the parse error when the reply is not an itinerary", () => {
    expect(() => parseStreamedItinerary('{"destination": {"name": "Lisbon"}, "days": []}', params)).toThrow("Invalid itinerary structure");
    expect(() => parseStreamedItinerary("not json at all", params)).toThrow(SyntaxError);
  });
});
