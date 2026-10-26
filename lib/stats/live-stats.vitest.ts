import { describe, expect, it } from "vitest";
import { honestFloor, pickLiveStats } from "./live-stats";
import type { PublicStats } from "./public-stats";

const stats: PublicStats = {
  plans: 4004,
  plans30d: 1213,
  groupPlans: 2243,
  soloPlans: 883,
  shortPlans: 600,
  activities: 20253,
  medianPlanSeconds: 28,
};

describe("honestFloor", () => {
  it("rounds down to a figure that reads as a floor", () => {
    expect([4004, 1213, 883, 600, 20253, 99_999, 57].map(honestFloor)).toEqual([4000, 1200, 800, 600, 20000, 99000, 50]);
  });

  it("never rounds up", () => {
    for (const n of [1, 99, 100, 999, 1000, 9999, 10_000, 123_456]) expect(honestFloor(n)).toBeLessThanOrEqual(n);
  });
});

describe("pickLiveStats", () => {
  it("shows plans, the last 30 days, activities and speed on a page without a focus", () => {
    expect(pickLiveStats(stats)).toEqual([
      { key: "plans", value: 4000, unit: "+" },
      { key: "plans30d", value: 1200, unit: "+" },
      { key: "activities", value: 20000, unit: "+" },
      { key: "speed", value: 28, unit: "s" },
    ]);
  });

  it("puts the page's own figure in second place", () => {
    expect(pickLiveStats(stats, "group")[1]).toEqual({ key: "group", value: 2200, unit: "+" });
    expect(pickLiveStats(stats, "solo")[1]).toEqual({ key: "solo", value: 800, unit: "+" });
    expect(pickLiveStats(stats, "short")[1]).toEqual({ key: "short", value: 600, unit: "+" });
  });

  it("falls back to the last 30 days when the page's figure is too small to prove anything", () => {
    expect(pickLiveStats({ ...stats, soloPlans: 120 }, "solo")[1].key).toBe("plans30d");
  });

  it("leaves out small or implausible figures", () => {
    const picked = pickLiveStats({ ...stats, plans: 900, activities: 4000, medianPlanSeconds: 400 });
    expect(picked.map((s) => s.key)).toEqual(["plans30d"]);
    expect(pickLiveStats({ ...stats, medianPlanSeconds: null }).map((s) => s.key)).not.toContain("speed");
  });
});
