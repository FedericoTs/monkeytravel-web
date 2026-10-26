import { describe, expect, it } from "vitest";
import { isKeptToken, parseKeptPlan } from "./kept-plan";

const plan = () => ({
  destination: "Lisbon, Portugal",
  startDate: "2027-03-15",
  endDate: "2027-03-17",
  itinerary: {
    destination: { name: "Lisbon", country: "Portugal", description: "", best_for: [], weather_note: "" },
    days: [
      {
        day_number: 1,
        activities: [
          { name: "Belém Tower", image_url: "https://upload.wikimedia.org/belem.jpg", booking_url: "https://tickets.example/belem" },
          { name: "Tram 28", image_url: "javascript:alert(1)", booking_url: "http://plain.example", official_website: "//evil.example" },
          { name: "Alfama", image_url: "/api/images/wikimedia/abc-500.jpg?a=x", official_website: "https://alfama.example" },
        ],
      },
    ],
    trip_summary: { total_estimated_cost: 400, currency: "EUR", highlights: [], packing_suggestions: [] },
    booking_links: {
      flights: [{ url: "https://flights.example", label: "Flights" }, { url: "data:text/html,x", label: "Bad" }],
      hotels: [],
    },
  },
  pace: "moderate",
  vibes: ["foodie", "cultural", "made-up"],
  budgetTier: "balanced",
  travelStyle: "classic",
  tripIntent: "group",
  flexibleDates: true,
  mustDos: ["Pastéis de Belém", 42],
});

describe("parseKeptPlan", () => {
  it("keeps what the planner needs to put a plan back on screen", () => {
    const kept = parseKeptPlan(plan())!;
    expect(kept).toMatchObject({
      destination: "Lisbon, Portugal",
      startDate: "2027-03-15",
      endDate: "2027-03-17",
      pace: "moderate",
      vibes: ["foodie", "cultural"],
      budgetTier: "balanced",
      travelStyle: "classic",
      tripIntent: "group",
      flexibleDates: true,
      mustDos: ["Pastéis de Belém"],
    });
    expect(kept.itinerary.days).toHaveLength(1);
  });

  it("lets through https links and this site's own paths, nothing else", () => {
    const [belem, tram, alfama] = parseKeptPlan(plan())!.itinerary.days[0].activities as unknown as Array<Record<string, unknown>>;
    expect(belem.image_url).toBe("https://upload.wikimedia.org/belem.jpg");
    expect(belem.booking_url).toBe("https://tickets.example/belem");
    expect(tram).not.toHaveProperty("image_url");
    expect(tram).not.toHaveProperty("booking_url");
    expect(tram).not.toHaveProperty("official_website");
    expect(alfama.image_url).toBe("/api/images/wikimedia/abc-500.jpg?a=x");
    expect(alfama.official_website).toBe("https://alfama.example");
    expect(parseKeptPlan(plan())!.itinerary.booking_links?.flights.map((l) => l.url)).toEqual(["https://flights.example"]);
  });

  it("drops values the planner has no use for", () => {
    const kept = parseKeptPlan({ ...plan(), pace: "frantic", budgetTier: "infinite", travelStyle: "x", tripIntent: "unspecified", flexibleDates: "yes" })!;
    expect(kept).not.toHaveProperty("pace");
    expect(kept).not.toHaveProperty("budgetTier");
    expect(kept).not.toHaveProperty("travelStyle");
    expect(kept).not.toHaveProperty("tripIntent");
    expect(kept).not.toHaveProperty("flexibleDates");
  });

  it("is not a plan without a place, valid dates and days with activities", () => {
    expect(parseKeptPlan(null)).toBeNull();
    expect(parseKeptPlan({ ...plan(), destination: " " })).toBeNull();
    expect(parseKeptPlan({ ...plan(), startDate: "2027-02-31" })).toBeNull();
    expect(parseKeptPlan({ ...plan(), endDate: "2027-03-14" })).toBeNull();
    const base = plan();
    expect(parseKeptPlan({ ...base, itinerary: { ...base.itinerary, days: [] } })).toBeNull();
    expect(parseKeptPlan({ ...base, itinerary: { ...base.itinerary, days: Array(22).fill({ activities: [] }) } })).toBeNull();
    expect(parseKeptPlan({ ...base, itinerary: { ...base.itinerary, days: [{ day_number: 1 }] } })).toBeNull();
    expect(parseKeptPlan({ ...base, itinerary: { ...base.itinerary, trip_summary: undefined } })).toBeNull();
  });
});

describe("isKeptToken", () => {
  it("is 22 base64url characters", () => {
    expect(isKeptToken("AbCdEfGhIjKlMnOpQrSt_-")).toBe(true);
    expect(isKeptToken("AbCdEfGhIjKlMnOpQrSt_")).toBe(false);
    expect(isKeptToken("AbCdEfGhIjKlMnOpQrSt.x")).toBe(false);
    expect(isKeptToken(null)).toBe(false);
  });
});
