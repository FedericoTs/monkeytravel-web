import { describe, it, expect } from "vitest";
import {
  isValidIsoDate,
  sanitizeIsoDate,
  maxTripStartDate,
  isPlausibleTripDate,
  isPlausibleTripRange,
} from "./iso-date";
import { addDaysISO } from "@/lib/ai/multi-city-core";

/**
 * Regression cover for Sentry JAVASCRIPT-NEXTJS-1J:
 *   MultiCityError: addDaysISO: invalid date "20220-05-01"
 * A five-digit year is a legal <input type="date"> value but not a legal ISO
 * 8601 date without a sign, so it crashed multi-city generation.
 */

describe("isValidIsoDate", () => {
  it("rejects the five-digit year that crashed the wizard", () => {
    expect(isValidIsoDate("20220-05-01")).toBe(false);
  });

  it("accepts ordinary dates", () => {
    expect(isValidIsoDate("2026-05-01")).toBe(true);
    expect(isValidIsoDate("2028-02-29")).toBe(true); // real leap day
  });

  it("rejects impossible calendar dates rather than normalising them", () => {
    // new Date() would silently roll these forward.
    expect(isValidIsoDate("2026-02-31")).toBe(false);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(isValidIsoDate("2027-02-29")).toBe(false); // not a leap year
  });

  it("rejects partial and malformed input", () => {
    for (const v of ["", "2026", "2026-05", "05-01-2026", "2026/05/01", "abc"]) {
      expect(isValidIsoDate(v), `${v} should be rejected`).toBe(false);
    }
  });
});

describe("sanitizeIsoDate", () => {
  it("passes a real date through untouched", () => {
    expect(sanitizeIsoDate("2026-05-01")).toBe("2026-05-01");
  });

  it("collapses anything invalid to an empty field, not a crash", () => {
    expect(sanitizeIsoDate("20220-05-01")).toBe("");
    expect(sanitizeIsoDate("2026-02-31")).toBe("");
  });

  it("its output is always safe for addDaysISO — the original crash site", () => {
    // The bug: "20220-05-01" reached addDaysISO and threw MultiCityError.
    expect(() => addDaysISO("20220-05-01", 1)).toThrow();

    // After sanitising, the wizard can only ever hand it a valid date or "".
    const cleaned = sanitizeIsoDate("20220-05-01");
    expect(cleaned).toBe("");
    // And a genuine value still round-trips correctly.
    expect(addDaysISO(sanitizeIsoDate("2026-05-01"), 4)).toBe("2026-05-05");
  });
});

describe("maxTripStartDate", () => {
  it("bounds the input a few years out, in ISO form", () => {
    const max = maxTripStartDate(new Date("2026-08-21T00:00:00Z"));
    expect(max).toBe("2031-08-21");
    expect(isValidIsoDate(max)).toBe(true);
  });

  it("is far enough ahead not to block real planning", () => {
    const now = new Date("2026-08-21T00:00:00Z");
    const max = new Date(`${maxTripStartDate(now)}T00:00:00Z`);
    const yearsAhead =
      (max.getTime() - now.getTime()) / (365.25 * 24 * 3600 * 1000);
    expect(yearsAhead).toBeGreaterThan(4);
  });
});

describe("isPlausibleTripDate", () => {
  const NOW = new Date("2026-09-12T08:00:00Z");

  it("rejects the partial years a date field reports while the year is typed", () => {
    // 0002 → 0020 → 0202 → 2026: every step is a valid date to the input and
    // to isValidIsoDate, and each one reached Open-Meteo as an HTTP 400.
    for (const v of ["0002-10-30", "0020-10-30", "0202-10-30", "0201-11-06"]) {
      expect(isValidIsoDate(v), `${v} is a valid date shape`).toBe(true);
      expect(isPlausibleTripDate(v, NOW), `${v} is not a plausible trip date`).toBe(false);
    }
  });

  it("accepts dates from a year back to five years ahead", () => {
    expect(isPlausibleTripDate("2025-09-12", NOW)).toBe(true);
    expect(isPlausibleTripDate("2026-10-30", NOW)).toBe(true);
    expect(isPlausibleTripDate("2031-01-01", NOW)).toBe(true);
  });

  it("rejects dates outside that window and anything malformed", () => {
    expect(isPlausibleTripDate("2024-12-31", NOW)).toBe(false);
    expect(isPlausibleTripDate("2032-01-01", NOW)).toBe(false);
    expect(isPlausibleTripDate("20220-05-01", NOW)).toBe(false);
    expect(isPlausibleTripDate("", NOW)).toBe(false);
  });
});

describe("isPlausibleTripRange", () => {
  const NOW = new Date("2026-09-12T08:00:00Z");

  it("accepts an ordered pair of plausible dates", () => {
    expect(isPlausibleTripRange("2026-10-30", "2026-11-06", NOW)).toBe(true);
    expect(isPlausibleTripRange("2026-10-30", "2026-10-30", NOW)).toBe(true);
  });

  it("rejects a range that ends before it starts (the Paris 400 on 2026-09-12)", () => {
    expect(isPlausibleTripRange("2026-03-20", "2026-03-19", NOW)).toBe(false);
  });

  it("rejects a range with a partial year at either end", () => {
    expect(isPlausibleTripRange("0202-10-30", "2026-11-06", NOW)).toBe(false);
    expect(isPlausibleTripRange("2026-10-30", "0202-11-06", NOW)).toBe(false);
  });
});
