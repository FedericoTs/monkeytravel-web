import { describe, expect, it } from "vitest";
import { validateTripParams } from "@/lib/gemini";
import { addDaysISO } from "@/lib/ai/multi-city-core";
import { destinationProblem } from "@/lib/wizard/step1-gate";
import type { TripCreationParams, TripVibe } from "@/types";
import {
  DESTINATION_MAX_LENGTH,
  DESTINATION_MIN_LENGTH,
  MAX_TRIP_DAYS,
  MAX_TRIP_DAYS_MULTI,
  MUST_DOS_MAX,
  MUST_DO_MAX_LENGTH,
  REQUIREMENTS_MAX,
  VIBES_MAX,
} from "./request-limits";

/**
 * The trip request's limits are declared once and held by both sides: the
 * server accepts a request at each limit and refuses one past it, and the
 * wizard's destination gate refuses exactly what the server does.
 */

const START = "2099-08-11";
const params = (over: Partial<TripCreationParams>): TripCreationParams => ({
  destination: "Lisbon",
  startDate: START,
  endDate: "2099-08-15",
  budgetTier: "balanced",
  pace: "moderate",
  vibes: ["cultural"],
  interests: [],
  ...over,
});
// A span of `days` days, counted as the server counts them (both ends in).
const spanning = (days: number) => ({ endDate: addDaysISO(START, days - 1) });
const ok = (over: Partial<TripCreationParams>, opts?: { maxDays?: number }) => validateTripParams(params(over), opts).valid;

describe("the trip request's limits", () => {
  it("are the server's: a request at each limit passes, and one past it does not", () => {
    const at: [string, Partial<TripCreationParams>, Partial<TripCreationParams>][] = [
      ["destination, shortest", { destination: "a".repeat(DESTINATION_MIN_LENGTH) }, { destination: "a".repeat(DESTINATION_MIN_LENGTH - 1) }],
      ["destination, longest", { destination: "a".repeat(DESTINATION_MAX_LENGTH) }, { destination: "a".repeat(DESTINATION_MAX_LENGTH + 1) }],
      ["requirements", { requirements: "a".repeat(REQUIREMENTS_MAX) }, { requirements: "a".repeat(REQUIREMENTS_MAX + 1) }],
      ["must-dos", { mustDos: Array.from({ length: MUST_DOS_MAX }, (_, i) => `wish ${i}`) }, { mustDos: Array.from({ length: MUST_DOS_MAX + 1 }, (_, i) => `wish ${i}`) }],
      ["a must-do's length", { mustDos: ["a".repeat(MUST_DO_MAX_LENGTH)] }, { mustDos: ["a".repeat(MUST_DO_MAX_LENGTH + 1)] }],
      ["vibes", { vibes: ["cultural", "foodie", "adventure"].slice(0, VIBES_MAX) as TripVibe[] }, { vibes: ["cultural", "foodie", "adventure", "relaxation"].slice(0, VIBES_MAX + 1) as TripVibe[] }],
      ["days", spanning(MAX_TRIP_DAYS), spanning(MAX_TRIP_DAYS + 1)],
    ];
    for (const [name, atLimit, past] of at) {
      expect(ok(atLimit), `${name} at the limit`).toBe(true);
      expect(ok(past), `${name} past the limit`).toBe(false);
    }
  });

  it("let a multi-city trip run to its own cap", () => {
    const multi = { maxDays: MAX_TRIP_DAYS_MULTI };
    expect(ok(spanning(MAX_TRIP_DAYS_MULTI), multi)).toBe(true);
    expect(ok(spanning(MAX_TRIP_DAYS_MULTI + 1), multi)).toBe(false);
  });

  it("are the wizard's: its destination gate refuses exactly what the server refuses", () => {
    const names = [
      "a".repeat(DESTINATION_MIN_LENGTH - 1),
      "a".repeat(DESTINATION_MIN_LENGTH),
      "a".repeat(DESTINATION_MAX_LENGTH),
      "a".repeat(DESTINATION_MAX_LENGTH + 1),
      "São Paulo, Brazil",
      "Saint-Jean-de-Luz (France)",
      "Rome; DROP TABLE",
      "Tokyo <3",
    ];
    for (const destination of names) {
      expect(destinationProblem(destination) === null, destination).toBe(ok({ destination }));
    }
  });
});
