import { describe, it, expect } from "vitest";
import {
  buildSeasonalContext,
  relevantHolidaysForDestination,
  HOLIDAYS_BY_MONTH,
} from "./index";

/**
 * The Trieste-trip bug, reproduced as a test:
 *
 *   May 28–30 trip surfaced "Labor Day (varies)" (May 1) and
 *   "Mother's Day (varies)" (~May 10) — both clearly outside the trip
 *   window. Root cause: relevantHolidaysForDestination ignored end date
 *   and returned every holiday in the month.
 *
 * Fix shipped in commit 78d5795: added `dayOfMonth` to fixed-date
 * holiday entries + filter against [startDate, endDate].
 *
 * These tests pin the new contract so the bug can't silently
 * regress when someone touches the seasonal lib later.
 */
describe("relevantHolidaysForDestination — trip-window filter", () => {
  // Trieste is in Italy; "Labor Day" is global (no countries → matches).
  // "Mother's Day (varies)" has no dayOfMonth → falls through to the
  // legacy month-only behavior (which is the correct call: we don't
  // compute the 2nd-Sunday-of-May date here).
  const TRIESTE = "Trieste, Italy";

  it("drops out-of-range fixed-date holidays (Trieste May 28-30)", () => {
    const holidays = relevantHolidaysForDestination(TRIESTE, 5, {
      startDate: "2026-05-28",
      endDate: "2026-05-30",
    });
    expect(holidays).not.toContain("Labor Day");
    // Mother's Day has no dayOfMonth, so it still surfaces — that's
    // by design (the "(varies)" suffix in its name signals the looseness).
    expect(holidays).toContain("Mother's Day (varies)");
  });

  it("keeps in-range fixed-date holidays (Italy May 1-7 → Labor Day)", () => {
    const holidays = relevantHolidaysForDestination(TRIESTE, 5, {
      startDate: "2026-05-01",
      endDate: "2026-05-07",
    });
    expect(holidays).toContain("Labor Day");
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

  it("returns variable holidays even when no fixed-date hits (Italy May 15-20)", () => {
    // Window doesn't contain May 1, so Labor Day drops. Mother's Day
    // has no dayOfMonth so it sticks. The list is non-empty.
    const holidays = relevantHolidaysForDestination(TRIESTE, 5, {
      startDate: "2026-05-15",
      endDate: "2026-05-20",
    });
    expect(holidays).not.toContain("Labor Day");
    expect(holidays).toContain("Mother's Day (varies)");
  });

  it("falls back to month-only behavior when no window is passed", () => {
    // No tripWindow → old behavior: every holiday for the month-country.
    const holidays = relevantHolidaysForDestination(TRIESTE, 5);
    expect(holidays).toContain("Labor Day");
    expect(holidays).toContain("Mother's Day (varies)");
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

describe("buildSeasonalContext — threads endDate through", () => {
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
});

describe("HOLIDAYS_BY_MONTH — dayOfMonth contract", () => {
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

  it("leaves dayOfMonth undefined on entries that genuinely vary", () => {
    const may = HOLIDAYS_BY_MONTH[5];
    const mothersDay = may.find((h) => h.name.startsWith("Mother's Day"));
    expect(mothersDay?.dayOfMonth).toBeUndefined();

    const apr = HOLIDAYS_BY_MONTH[4];
    const easter = apr.find((h) => h.name.startsWith("Easter"));
    expect(easter?.dayOfMonth).toBeUndefined();
  });
});
