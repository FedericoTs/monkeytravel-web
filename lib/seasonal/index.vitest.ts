import { describe, it, expect } from "vitest";
import {
  buildSeasonalContext,
  relevantHolidaysForDestination,
  tripMonths,
  HOLIDAYS_BY_MONTH,
} from "./index";

/**
 * The holidays a trip is told about are the ones on its own dates: each listed holiday carries its day of the
 * month and is checked against [startDate, endDate], across every month the trip touches. A holiday that moves
 * from year to year can't be checked that way, so none is listed.
 */
describe("relevantHolidaysForDestination — trip-window filter", () => {
  // Trieste is in Italy; "Labor Day" is global (no countries → matches).
  const TRIESTE = "Trieste, Italy";

  it("drops out-of-range fixed-date holidays (Trieste May 28-30)", () => {
    const holidays = relevantHolidaysForDestination(TRIESTE, 5, {
      startDate: "2026-05-28",
      endDate: "2026-05-30",
    });
    expect(holidays).toEqual([]);
  });

  it("keeps in-range fixed-date holidays (Italy May 1-7 → Labor Day)", () => {
    const holidays = relevantHolidaysForDestination(TRIESTE, 5, {
      startDate: "2026-05-01",
      endDate: "2026-05-07",
    });
    expect(holidays).toContain("Labor Day");
  });

  it("keeps a holiday on the trip's first or last day", () => {
    const first = relevantHolidaysForDestination(TRIESTE, 5, { startDate: "2026-05-01", endDate: "2026-05-03" });
    const last = relevantHolidaysForDestination(TRIESTE, 5, { startDate: "2026-04-28", endDate: "2026-05-01" });
    expect(first).toContain("Labor Day");
    expect(last).toContain("Labor Day");
  });

  it("keeps fixed-date holidays when the window straddles month boundaries (Apr 25 – May 5)", () => {
    // Even though the window starts in April, we're asked specifically
    // about May (month=5) — and May 1 falls inside the window.
    const holidays = relevantHolidaysForDestination(TRIESTE, 5, {
      startDate: "2026-04-25",
      endDate: "2026-05-05",
    });
    expect(holidays).toContain("Labor Day");
  });

  it("names nothing when no holiday falls inside the trip (Italy May 15-20)", () => {
    const holidays = relevantHolidaysForDestination(TRIESTE, 5, {
      startDate: "2026-05-15",
      endDate: "2026-05-20",
    });
    expect(holidays).toEqual([]);
  });

  it("finds a holiday in the second year of a trip over New Year", () => {
    const window = { startDate: "2026-12-28", endDate: "2027-01-03" };
    expect(relevantHolidaysForDestination("Tokyo, Japan", 1, window)).toEqual(["New Year's Day"]);
    expect(relevantHolidaysForDestination("Tokyo, Japan", 12, window)).toEqual(["New Year's Eve"]);
  });

  it("falls back to the month's dated holidays when no window is passed", () => {
    const holidays = relevantHolidaysForDestination(TRIESTE, 5);
    expect(holidays).toEqual(["Labor Day"]);
  });

  it("country-filters before date-filters (USA July 4 → Independence Day in window)", () => {
    const holidays = relevantHolidaysForDestination("New York, USA", 7, {
      startDate: "2026-07-01",
      endDate: "2026-07-10",
    });
    expect(holidays).toContain("Independence Day");
  });

  it("country-filters reject Independence Day for non-US destinations", () => {
    const holidays = relevantHolidaysForDestination("Trieste, Italy", 7, {
      startDate: "2026-07-01",
      endDate: "2026-07-10",
    });
    expect(holidays).not.toContain("Independence Day");
  });

  it("drops Independence Day for a July 5-10 USA trip (July 4 outside window)", () => {
    const holidays = relevantHolidaysForDestination("New York, USA", 7, {
      startDate: "2026-07-05",
      endDate: "2026-07-10",
    });
    expect(holidays).not.toContain("Independence Day");
  });
});

describe("tripMonths", () => {
  it("lists the months a trip touches, in order", () => {
    expect(tripMonths("2027-04-15", "2027-04-18")).toEqual([4]);
    expect(tripMonths("2027-04-25", "2027-05-05")).toEqual([4, 5]);
    expect(tripMonths("2026-12-20", "2027-01-05")).toEqual([12, 1]);
  });

  it("is the first month without an end date, or with one before the start", () => {
    expect(tripMonths("2027-04-15")).toEqual([4]);
    expect(tripMonths("2027-04-15", "2027-03-01")).toEqual([4]);
  });

  it("stops at twelve months", () => {
    expect(tripMonths("2027-01-01", "2029-06-01")).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("is null for a start that isn't YYYY-MM-DD", () => {
    expect(tripMonths("April 15")).toBeNull();
  });
});

describe("buildSeasonalContext — the trip's own dates", () => {
  it("uses endDate when provided so out-of-range holidays drop", () => {
    const ctx = buildSeasonalContext(
      "Trieste, Italy",
      "2026-05-28",
      undefined, // latitude unknown — defaults to northern
      "2026-05-30",
    );
    expect(ctx.holidays).not.toContain("Labor Day");
  });

  it("falls back to month-only when endDate is omitted", () => {
    const ctx = buildSeasonalContext("Trieste, Italy", "2026-05-28");
    expect(ctx.holidays).toContain("Labor Day");
  });

  it("names no holiday a spring trip doesn't have (Easter and Mother's Day fall elsewhere)", () => {
    expect(buildSeasonalContext("Lisbon, Portugal", "2027-04-15", 38.7, "2027-04-18").holidays).toEqual([]);
    expect(buildSeasonalContext("Kyoto, Japan", "2027-04-05", 35.0, "2027-04-09").holidays).toEqual([]);
    expect(buildSeasonalContext("Trieste, Italy", "2027-05-03", 45.6, "2027-05-06").holidays).toEqual([]);
  });

  it("reads every month the trip touches", () => {
    expect(buildSeasonalContext("Trieste, Italy", "2026-04-25", 45.6, "2026-05-05").holidays).toEqual(["Labor Day"]);
    expect(buildSeasonalContext("Tokyo, Japan", "2026-12-28", 35.7, "2027-01-03").holidays).toEqual([
      "New Year's Eve",
      "New Year's Day",
    ]);
  });

  it("keeps at most three, in the order of the trip", () => {
    const ctx = buildSeasonalContext("Madrid, Spain", "2026-12-20", 40.4, "2027-01-07");
    expect(ctx.holidays).toEqual(["Christmas", "New Year's Eve", "New Year's Day"]);
  });

  it("lists them by date", () => {
    expect(buildSeasonalContext("London, United Kingdom", "2026-12-20", 51.5, "2027-01-02").holidays).toEqual([
      "Christmas",
      "Boxing Day",
      "New Year's Eve",
    ]);
  });

  it("calls a trip over Christmas or New Year busy", () => {
    expect(buildSeasonalContext("Tokyo, Japan", "2026-12-28", 35.7, "2027-01-03").crowdLevel).toBe("peak");
  });
});

describe("HOLIDAYS_BY_MONTH — every holiday has its day", () => {
  it("populates dayOfMonth for known fixed-date entries", () => {
    const may = HOLIDAYS_BY_MONTH[5];
    const laborDay = may.find((h) => h.name === "Labor Day");
    expect(laborDay?.dayOfMonth).toBe(1);

    const july = HOLIDAYS_BY_MONTH[7];
    const independenceDay = july.find((h) => h.name === "Independence Day");
    expect(independenceDay?.dayOfMonth).toBe(4);

    const bastilleDay = july.find((h) => h.name === "Bastille Day");
    expect(bastilleDay?.dayOfMonth).toBe(14);

    const nov = HOLIDAYS_BY_MONTH[11];
    const allSaints = nov.find((h) => h.name === "All Saints' Day");
    expect(allSaints?.dayOfMonth).toBe(1);
  });

  it("lists no holiday without a real day of that month", () => {
    for (let month = 1; month <= 12; month++) {
      const daysInMonth = new Date(Date.UTC(2027, month, 0)).getUTCDate();
      for (const h of HOLIDAYS_BY_MONTH[month] ?? []) {
        expect(Number.isInteger(h.dayOfMonth), h.name).toBe(true);
        expect(h.dayOfMonth, h.name).toBeGreaterThanOrEqual(1);
        expect(h.dayOfMonth, h.name).toBeLessThanOrEqual(daysInMonth);
        expect(h.name, h.name).not.toMatch(/varies/i);
      }
    }
  });
});
