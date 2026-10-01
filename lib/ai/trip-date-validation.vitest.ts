import { describe, it, expect, vi, afterEach } from "vitest";
import { validateTripParams } from "@/lib/gemini";
import { addDaysISO } from "@/lib/ai/multi-city-core";
import { classifyGenerationFailure } from "@/lib/wizard/generation-failure";
import type { TripCreationParams } from "@/types";

/**
 * Regression cover for Sentry JAVASCRIPT-NEXTJS-1J
 * ("MultiCityError: addDaysISO: invalid date \"20220-08-11\"").
 *
 * Root cause was a parsing asymmetry, not a bad helper:
 *   new Date("20220-08-11")            -> VALID (lenient legacy parser, year 20220)
 *   new Date("20220-08-11T00:00:00Z")  -> Invalid Date (strict ISO parser)
 *
 * validateTripParams used the lenient form, so a 5-digit year (reachable
 * because <input type="date"> accepts years up to 275760) sailed through the
 * API boundary and then threw downstream in addDaysISO, aborting multi-city
 * generation. These tests pin both halves of that contract.
 */

function params(overrides: Partial<TripCreationParams>): TripCreationParams {
  return {
    destination: "Lisbon",
    startDate: "2099-08-11",
    endDate: "2099-08-15",
    budgetTier: "balanced",
    pace: "moderate",
    vibes: ["cultural"],
    interests: [],
    ...overrides,
  } as TripCreationParams;
}

describe("validateTripParams — date format", () => {
  it("rejects the 5-digit year that used to crash multi-city generation", () => {
    const result = validateTripParams(
      params({ startDate: "20220-08-11", endDate: "20220-08-15" })
    );
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Invalid date format");
  });

  it("rejects a 5-digit year on endDate alone", () => {
    const result = validateTripParams(
      params({ startDate: "2099-08-11", endDate: "20990-08-15" })
    );
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Invalid date format");
  });

  it.each(["11/08/2099", "2099-8-1", "2099/08/11", "not-a-date", ""])(
    "rejects non-ISO date shape %j",
    (bad) => {
      expect(validateTripParams(params({ startDate: bad })).valid).toBe(false);
    }
  );

  it("still accepts a well-formed future YYYY-MM-DD range", () => {
    expect(validateTripParams(params({})).valid).toBe(true);
  });

  it("only lets through dates addDaysISO can actually consume", () => {
    // The contract that was broken: anything validateTripParams accepts must
    // survive the strict-ISO parse downstream.
    const good = params({});
    expect(validateTripParams(good).valid).toBe(true);
    expect(() => addDaysISO(good.startDate, 3)).not.toThrow();
    expect(addDaysISO(good.startDate, 3)).toBe("2099-08-14");
  });

  it("addDaysISO still throws loudly on a 5-digit year (guard intact)", () => {
    expect(() => addDaysISO("20220-08-11", 1)).toThrow(/invalid date/i);
  });
});

describe("validateTripParams — start date vs timezone", () => {
  afterEach(() => vi.useRealTimers());

  it("accepts the traveller's local today when UTC is already tomorrow", () => {
    // 03:34 UTC on Oct 1 is still the evening of Sep 30 in the Americas.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T03:34:00Z"));
    const result = validateTripParams(
      params({ startDate: "2026-09-30", endDate: "2026-10-05" })
    );
    expect(result.valid).toBe(true);
  });

  it("still rejects a start date two days in the past", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T03:34:00Z"));
    const result = validateTripParams(
      params({ startDate: "2026-09-29", endDate: "2026-10-05" })
    );
    expect(result.error).toBe("Start date cannot be in the past");
    // The wizard must bucket this as validation, not "unknown".
    expect(classifyGenerationFailure(new Error(result.error))).toBe("validation");
  });

  it("classifies the duration cap as validation", () => {
    const result = validateTripParams(
      params({ startDate: "2099-08-01", endDate: "2099-08-20" })
    );
    expect(result.error).toBe("Maximum trip duration is 14 days");
    expect(classifyGenerationFailure(new Error(result.error))).toBe("validation");
  });
});
