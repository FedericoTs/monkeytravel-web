import { describe, it, expect } from "vitest";
import { getHistoricalDateRange } from "./historical-range";

/**
 * The bug this locks down: subtracting exactly one year sent a FUTURE date to
 * archive-api.open-meteo.com, which serves nothing past today. It answered 400
 * and the route turned that into a 500, so the weather panel broke for users
 * planning a year or more ahead.
 */
const NOW = new Date("2026-08-21T12:00:00Z");

describe("getHistoricalDateRange", () => {
  it("never returns a range that ends in the future", () => {
    // The API's ceiling is today; anything later is rejected outright.
    for (const [s, e] of [
      ["2026-09-01", "2026-09-07"],
      ["2027-10-15", "2027-10-22"], // the reported failure
      ["2029-03-01", "2029-03-10"],
      ["2035-01-01", "2035-01-05"], // absurdly far out
    ]) {
      const r = getHistoricalDateRange(s, e, NOW);
      expect(
        new Date(r.end) <= new Date("2026-08-21"),
        `${s}..${e} produced ${r.start}..${r.end}, which Open-Meteo would 400`
      ).toBe(true);
    }
  });

  it("preserves month and day, because the feature is about seasonality", () => {
    // "What is Rome like in mid-October" only holds if the dates line up.
    const r = getHistoricalDateRange("2027-10-15", "2027-10-22", NOW);
    expect(r.start.slice(5)).toBe("10-15");
    expect(r.end.slice(5)).toBe("10-22");
  });

  it("steps back whole years, not to an arbitrary clamp", () => {
    // 2027 is one step; 2029 needs three. Both land on the same month/day.
    expect(getHistoricalDateRange("2027-10-15", "2027-10-22", NOW)).toEqual({
      start: "2025-10-15",
      end: "2025-10-22",
    });
    expect(getHistoricalDateRange("2029-03-01", "2029-03-10", NOW)).toEqual({
      start: "2026-03-01",
      end: "2026-03-10",
    });
  });

  it("shifts both ends together so a range is never truncated", () => {
    const r = getHistoricalDateRange("2026-08-25", "2026-09-02", NOW);
    const days =
      (new Date(r.end).getTime() - new Date(r.start).getTime()) / 86_400_000;
    expect(days).toBe(8); // same span as the original range
  });

  it("uses UTC, so the calendar day does not drift on a host west of UTC", () => {
    // getFullYear/setFullYear are LOCAL-time; they returned 2026-03-09 here.
    const r = getHistoricalDateRange("2029-03-10", "2029-03-10", NOW);
    expect(r.start).toBe("2026-03-10");
    expect(r.end).toBe("2026-03-10");
  });

  it("still goes back a year for a trip that is already in the past", () => {
    const r = getHistoricalDateRange("2026-01-05", "2026-01-09", NOW);
    expect(r).toEqual({ start: "2025-01-05", end: "2025-01-09" });
  });
});
