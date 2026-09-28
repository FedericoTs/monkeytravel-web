import { describe, it, expect } from "vitest";
import { summarizeSpend, previousUtcDay } from "./spend";
import { recoveryLooksBroken } from "./auth-health";

describe("summarizeSpend", () => {
  const rows = [
    { api_name: "gemini", cost_usd: 0.01 },
    { api_name: "gemini", cost_usd: 0.02 },
    { api_name: "google_places", cost_usd: 0.05 },
    { api_name: "gemini", cost_usd: 5, request_params: { probe: true } }, // our own test run
    { api_name: "pexels", cost_usd: null },
  ];

  it("totals by API, most expensive first, leaving out probe rows", () => {
    const s = summarizeSpend(rows, 20);
    expect(s.byApi).toEqual([
      { apiName: "google_places", usd: 0.05, calls: 1 },
      { apiName: "gemini", usd: 0.03, calls: 2 },
      { apiName: "pexels", usd: 0, calls: 1 },
    ]);
    expect(s.totalUsd).toBe(0.08);
    expect(s.over).toBe(false);
  });

  it("flags a day over the limit", () => {
    expect(summarizeSpend([{ api_name: "gemini", cost_usd: 21 }], 20).over).toBe(true);
    expect(summarizeSpend([{ api_name: "gemini", cost_usd: 20 }], 20).over).toBe(false);
  });
});

describe("previousUtcDay", () => {
  it("is the whole UTC day before, whatever the time now", () => {
    const d = previousUtcDay(new Date("2026-09-28T00:20:00Z"));
    expect(d).toEqual({ start: "2026-09-27T00:00:00.000Z", end: "2026-09-28T00:00:00.000Z", label: "2026-09-27" });
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
