import { describe, it, expect } from "vitest";
import { summarizeSpend, previousUtcDay, monthToDateBefore } from "./spend";
import { recoveryLooksBroken } from "./auth-health";

/** An api_spend_by_unit group: `calls` calls of `api` booked at `unit` each. */
const group = (api_name: string, unit_usd: number, calls: number, usd = unit_usd * calls) => ({ api_name, unit_usd, calls, usd });

describe("summarizeSpend", () => {
  it("charges only the calls past the free allowance when the day crosses it", () => {
    // Place Details Pro: 5,000 free a month, 4,900 used before the day.
    const s = summarizeSpend([group("google_places_details", 0.017, 4900)], [group("google_places_details", 0.017, 300)], 20);
    expect(s.byApi).toEqual([{ apiName: "google_places_details", calls: 300, listUsd: 5.1, estimatedUsd: 3.4 }]);
  });

  it("charges every call once the allowance is used up, and none before it is", () => {
    const before = [group("google_places_search", 0.032, 6000), group("google_places_photo", 0.007, 200)];
    const day = [group("google_places_search", 0.032, 100), group("google_places_photo", 0.007, 300)];
    expect(summarizeSpend(before, day, 20).byApi).toEqual([
      { apiName: "google_places_search", calls: 100, listUsd: 3.2, estimatedUsd: 3.2 },
      { apiName: "google_places_photo", calls: 300, listUsd: 2.1, estimatedUsd: 0 },
    ]);
  });

  it.each([
    ["google_places_details", 0.005, 10_000],
    ["google_places_details", 0.017, 5_000],
    ["google_places_details", 0.02, 1_000],
    ["google_places_details", 0.025, 1_000],
    ["google_places_search", 0.032, 5_000],
    ["google_places_search", 0.035, 1_000],
    ["google_places_search", 0.04, 1_000],
    ["google_places_photo", 0.007, 1_000],
  ])("%s at $%s a call has %i free calls a month", (api, unit, free) => {
    const s = summarizeSpend([group(api, unit, free - 1)], [group(api, unit, 1001)], 20);
    expect(s.byApi[0].estimatedUsd).toBe(Math.round(1000 * unit * 100) / 100);
  });

  it("counts only calls at a SKU's price against its allowance, not the $0 ones", () => {
    // Cache hits and failed photo downloads are logged at $0.
    const before = [group("google_places_photo", 0, 5000), group("google_places_photo", 0.007, 900)];
    const s = summarizeSpend(before, [group("google_places_photo", 0, 50), group("google_places_photo", 0.007, 200)], 20);
    expect(s.byApi).toEqual([{ apiName: "google_places_photo", calls: 250, listUsd: 1.4, estimatedUsd: 0.7 }]);
  });

  it("prices Gemini at exactly what was logged, however much the month used", () => {
    const gemini = [
      { api_name: "gemini", unit_usd: 0.012491, calls: 2, usd: 0.024982 },
      { api_name: "gemini", unit_usd: 0.065942, calls: 1, usd: 0.065942 },
      { api_name: "gemini", unit_usd: 0.007, calls: 5000, usd: 35 },
    ];
    expect(summarizeSpend(gemini, gemini, 50).byApi).toEqual([{ apiName: "gemini", calls: 5003, listUsd: 35.09, estimatedUsd: 35.09 }]);
  });

  it("prices an API or a per-call price it does not know at what was logged", () => {
    const day = [group("maps_grounding", 0.025, 4), group("google_places_search", 0.005, 10)];
    expect(summarizeSpend(day, day, 20).byApi).toEqual([
      { apiName: "maps_grounding", calls: 4, listUsd: 0.1, estimatedUsd: 0.1 },
      { apiName: "google_places_search", calls: 10, listUsd: 0.05, estimatedUsd: 0.05 },
    ]);
  });

  it("compares the estimate with the limit, not the list price", () => {
    const before = [group("google_places_search", 0.032, 1500)];
    const s = summarizeSpend(before, [group("google_places_search", 0.032, 700), group("gemini", 0.5, 2)], 20);
    expect(s).toMatchObject({ listUsd: 23.4, estimatedUsd: 1, over: false });
    expect(summarizeSpend([], [group("gemini", 0.5, 41)], 20)).toMatchObject({ estimatedUsd: 20.5, over: true });
    expect(summarizeSpend([], [group("gemini", 0.5, 40)], 20)).toMatchObject({ estimatedUsd: 20, over: false });
  });
});

describe("previousUtcDay", () => {
  it("is the whole UTC day before, whatever the time now", () => {
    const d = previousUtcDay(new Date("2026-09-28T00:20:00Z"));
    expect(d).toEqual({ start: "2026-09-27T00:00:00.000Z", end: "2026-09-28T00:00:00.000Z", label: "2026-09-27" });
  });
});

describe("monthToDateBefore", () => {
  it("runs from the 1st of the month to yesterday when yesterday is the month's last day", () => {
    const day = previousUtcDay(new Date("2026-11-01T06:20:00Z"));
    expect(day.label).toBe("2026-10-31");
    expect(monthToDateBefore(day)).toEqual({ start: "2026-10-01T00:00:00.000Z", end: "2026-10-31T00:00:00.000Z" });
  });

  it("is empty when yesterday is the 1st, so the month starts with its whole allowance", () => {
    const day = previousUtcDay(new Date("2026-11-02T06:20:00Z"));
    expect(day.label).toBe("2026-11-01");
    expect(monthToDateBefore(day)).toEqual({ start: "2026-11-01T00:00:00.000Z", end: "2026-11-01T00:00:00.000Z" });
  });

  it("stays in yesterday's year on New Year's Day", () => {
    const day = previousUtcDay(new Date("2027-01-01T06:20:00Z"));
    expect(monthToDateBefore(day)).toEqual({ start: "2026-12-01T00:00:00.000Z", end: "2026-12-31T00:00:00.000Z" });
  });
});

describe("recoveryLooksBroken", () => {
  it("is the silent-failure signature: requests but never a change", () => {
    expect(recoveryLooksBroken({ recoveries: 12, recovery_users: 9, password_changes: 0 })).toBe(true);
  });

  it("is not a quiet fortnight or an occasional success", () => {
    expect(recoveryLooksBroken({ recoveries: 2, recovery_users: 2, password_changes: 0 })).toBe(false);
    expect(recoveryLooksBroken({ recoveries: 12, recovery_users: 9, password_changes: 1 })).toBe(false);
  });
});
