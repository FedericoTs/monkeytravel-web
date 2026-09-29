/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { mcpTripInput, parseMcpTime } from "./import";
import type { MCPDay } from "./schema";

const days: MCPDay[] = [
  {
    day: 1,
    theme: "Historic Center",
    activities: [
      { name: "Colosseum", time: "09:00-11:30", type: "attraction", description: "Arena", location: "Piazza del Colosseo", tip: "Book ahead" },
      { name: "Lunch", time: "12:30-14:00", type: "restaurant", description: "Trattoria" },
      { name: "Evening stroll", time: "20:00", type: "experience", description: "Trastevere" },
    ],
  },
  {
    day: 2,
    theme: "Vatican",
    activities: [
      { name: "Museums", time: "whenever", type: "museum", description: "Sistine Chapel" },
      { name: "Gelato", time: "afternoon", type: "food", description: "Giolitti" },
    ],
  },
];

describe("parseMcpTime", () => {
  it("reads a range, keeps an hour without an end, and falls back when the start is unreadable", () => {
    expect(parseMcpTime("09:00-11:30", 0)).toEqual({ start: 540, minutes: 150 });
    expect(parseMcpTime("12:30", 0)).toEqual({ start: 750, minutes: 60 });
    expect(parseMcpTime("whenever", 600)).toEqual({ start: 600, minutes: 60 });
    expect(parseMcpTime("22:00-01:00", 0)).toEqual({ start: 1320, minutes: 60 });
    expect(parseMcpTime(undefined, 615)).toEqual({ start: 615, minutes: 60 });
  });
});

describe("mcpTripInput", () => {
  const input = mcpTripInput(
    { destination: "Rome", travel_style: "relaxation", interests: ["history"], budget: "luxury", itinerary: days },
    "2026-11-10",
    "it"
  );

  it("dates the days from the start, keeps the themes as titles and ends on the last day", () => {
    expect(input.itinerary.days.map((d) => [d.day_number, d.date, d.title])).toEqual([
      [1, "2026-11-10", "Historic Center"],
      [2, "2026-11-11", "Vatican"],
    ]);
    expect(input.formState.endDate).toBe("2026-11-11");
  });

  it("maps times to slots and durations, tips to a list and a missing location to the destination", () => {
    const [colosseum, lunch, stroll] = input.itinerary.days[0].activities;
    expect(colosseum).toMatchObject({ time_slot: "morning", start_time: "09:00", duration_minutes: 150, location: "Piazza del Colosseo", tips: ["Book ahead"], booking_required: false });
    expect(lunch).toMatchObject({ time_slot: "afternoon", start_time: "12:30", duration_minutes: 90, location: "Rome", tips: [] });
    expect(stroll).toMatchObject({ time_slot: "evening", start_time: "20:00", duration_minutes: 60, type: "experience" });
  });

  it("runs a clock through a day whose times cannot be read", () => {
    const [museums, gelato] = input.itinerary.days[1].activities;
    expect(museums).toMatchObject({ start_time: "09:00", duration_minutes: 60 });
    expect(gelato).toMatchObject({ start_time: "10:30", duration_minutes: 60 });
  });

  it("carries the row's style, interests and budget into the form state and stamps English", () => {
    expect(input.formState).toMatchObject({ destination: "Rome", startDate: "2026-11-10", budgetTier: "premium", vibes: ["wellness"], derivedInterests: ["history"], locale: "it", pace: "moderate" });
    expect(input.itinerary.language).toBe("en");
    expect(input.itinerary.destination.name).toBe("Rome");
    expect(input.itinerary.trip_summary.packing_suggestions).toEqual([]);
  });

  it("defaults an unknown style and budget", () => {
    const plain = mcpTripInput({ destination: "Oslo", travel_style: "family", interests: null, budget: null, itinerary: days.slice(0, 1) }, "2026-11-10", "en");
    expect(plain.formState).toMatchObject({ budgetTier: "balanced", vibes: [], derivedInterests: [], endDate: "2026-11-10" });
  });
});
