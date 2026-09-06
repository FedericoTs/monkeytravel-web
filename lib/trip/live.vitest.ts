import { describe, expect, it } from "vitest";
import { computeTripDayState, dayDiff, isValidTimeZone, todayInTimeZone } from "./live";

// A fixed instant to make "today" deterministic:
// 2026-09-15T02:30:00Z.
//   - In Europe/Lisbon (UTC+1 DST) it is 2026-09-15 03:30 → date 2026-09-15.
//   - In Pacific/Auckland (UTC+12) it is 2026-09-15 14:30 → date 2026-09-15.
//   - In America/Los_Angeles (UTC-7 DST) it is 2026-09-14 19:30 → date 2026-09-14.
const NOW = new Date("2026-09-15T02:30:00Z");

describe("todayInTimeZone", () => {
  it("gives the local calendar date, not UTC's", () => {
    expect(todayInTimeZone("Europe/Lisbon", NOW)).toBe("2026-09-15");
    expect(todayInTimeZone("Pacific/Auckland", NOW)).toBe("2026-09-15");
    expect(todayInTimeZone("America/Los_Angeles", NOW)).toBe("2026-09-14");
  });
});

describe("isValidTimeZone", () => {
  it("accepts IANA zones and rejects junk", () => {
    expect(isValidTimeZone("Asia/Tokyo")).toBe(true);
    expect(isValidTimeZone("Europe/Lisbon")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
    expect(isValidTimeZone(undefined)).toBe(false);
  });
});

describe("dayDiff", () => {
  it("counts whole days across a DST boundary without drift", () => {
    // Europe DST ends 2026-10-25; the diff is by calendar date, so DST is irrelevant.
    expect(dayDiff("2026-10-24", "2026-10-26")).toBe(2);
    expect(dayDiff("2026-09-15", "2026-09-15")).toBe(0);
    expect(dayDiff("2026-09-15", "2026-09-14")).toBe(-1);
  });
});

describe("computeTripDayState", () => {
  const base = { timeZone: "Europe/Lisbon", now: NOW };

  it("is live on the current day and numbers it 1-based", () => {
    const s = computeTripDayState({ ...base, startDate: "2026-09-13", endDate: "2026-09-18" });
    expect(s.phase).toBe("live");
    expect(s.isLive).toBe(true);
    expect(s.dayNumber).toBe(3); // 13→1, 14→2, 15→3
    expect(s.totalDays).toBe(6);
    expect(s.todayLocalDate).toBe("2026-09-15");
    expect(s.daysUntilStart).toBe(-2);
    expect(s.timeZoneSource).toBe("stored");
  });

  it("is live on the first and last day (inclusive bounds)", () => {
    expect(computeTripDayState({ ...base, startDate: "2026-09-15", endDate: "2026-09-15" }).isLive).toBe(true);
    expect(computeTripDayState({ ...base, startDate: "2026-09-10", endDate: "2026-09-15" }).dayNumber).toBe(6);
    expect(computeTripDayState({ ...base, startDate: "2026-09-15", endDate: "2026-09-20" }).dayNumber).toBe(1);
  });

  it("is upcoming before the start and past after the end", () => {
    const up = computeTripDayState({ ...base, startDate: "2026-09-20", endDate: "2026-09-25" });
    expect(up.phase).toBe("upcoming");
    expect(up.isLive).toBe(false);
    expect(up.dayNumber).toBe(1);
    expect(up.daysUntilStart).toBe(5);

    const past = computeTripDayState({ ...base, startDate: "2026-09-01", endDate: "2026-09-05" });
    expect(past.phase).toBe("past");
    expect(past.dayNumber).toBe(5);
  });

  it("uses the TRIP zone, not the viewer's — a date-line case", () => {
    // A one-day trip on 2026-09-15 in Auckland. At NOW it is already the 15th
    // in Auckland (live) but still the 14th in Los Angeles.
    const trip = { startDate: "2026-09-15", endDate: "2026-09-15", now: NOW };
    expect(computeTripDayState({ ...trip, timeZone: "Pacific/Auckland" }).isLive).toBe(true);
    // If we (wrongly) used an LA viewer zone, the same trip would read upcoming.
    expect(computeTripDayState({ ...trip, timeZone: null, viewerTimeZone: "America/Los_Angeles" }).phase).toBe("upcoming");
  });

  it("falls back to the viewer zone, flagged", () => {
    const s = computeTripDayState({
      startDate: "2026-09-13",
      endDate: "2026-09-18",
      timeZone: null,
      viewerTimeZone: "Europe/Lisbon",
      now: NOW,
    });
    expect(s.isLive).toBe(true);
    expect(s.timeZoneSource).toBe("viewer");
  });

  it("returns unknown when no usable zone is available", () => {
    const s = computeTripDayState({ startDate: "2026-09-13", endDate: "2026-09-18", timeZone: null, now: NOW });
    expect(s.phase).toBe("unknown");
    expect(s.isLive).toBe(false);
    expect(s.dayNumber).toBeNull();
    expect(s.todayLocalDate).toBeNull();
    expect(s.timeZoneSource).toBe("none");
  });
});
