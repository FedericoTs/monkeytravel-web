// A zone with daylight saving on purpose: the bug only shows across a change.
process.env.TZ = "America/Chicago";

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { daysBetweenLocal, localTodayISO, parseLocalDate, toLocalISODate } from "./date-local";

/**
 * Trip dates are parsed as local midnights, and local midnights are 23 or 25
 * hours apart across a daylight-saving change. The planner used to round the
 * gap up ("Sat Oct 31 – Mon Nov 2 · 4 days" in Chicago, where clocks go back on
 * Nov 1) and the live trip view rounded it down (a day behind after clocks go
 * forward).
 */

const day = (iso: string) => parseLocalDate(iso)!;

describe("daysBetweenLocal", () => {
  it("counts whole days on ordinary dates", () => {
    expect(daysBetweenLocal(day("2026-10-10"), day("2026-10-12"))).toBe(2);
    expect(daysBetweenLocal(day("2026-10-10"), day("2026-10-10"))).toBe(0);
    expect(daysBetweenLocal(day("2026-10-12"), day("2026-10-10"))).toBe(-2);
  });

  it("is not thrown off when the clocks go back", () => {
    expect(daysBetweenLocal(day("2026-10-31"), day("2026-11-02"))).toBe(2);
  });

  it("is not thrown off when the clocks go forward", () => {
    expect(daysBetweenLocal(day("2027-03-13"), day("2027-03-15"))).toBe(2);
  });
});

describe("day counts use it", () => {
  const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

  it("the planner's trip length and the live trip's day number", () => {
    expect(source("components/ui/DateRangePicker.tsx")).toContain("daysBetweenLocal(startDate, endDate) + 1");
    expect(source("components/trip/OngoingTripView.tsx")).toContain("daysBetweenLocal(start, today) + 1");
  });
});

describe("localTodayISO", () => {
  afterEach(() => vi.useRealTimers());

  // 22:30 on Oct 31 in Chicago is already Nov 1 in UTC.
  it("is the day the traveller is in, not UTC's", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-01T03:30:00Z"));
    expect(localTodayISO()).toBe("2026-10-31");
    expect(new Date().toISOString().slice(0, 10)).toBe("2026-11-01");
  });

  it("reads back what parseLocalDate made", () => {
    expect(toLocalISODate(day("2026-03-08"))).toBe("2026-03-08");
    expect(toLocalISODate(day("2026-11-01"))).toBe("2026-11-01");
  });
});
