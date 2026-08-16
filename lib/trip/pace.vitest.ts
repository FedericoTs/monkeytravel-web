import { describe, it, expect } from "vitest";
import {
  PACE_BUDGETS,
  isOverpacked,
  normalizePace,
  paceBudgetPromptClause,
  sumPlannedMinutes,
} from "./pace";

const acts = (...durations: Array<number | null | undefined>) =>
  durations.map((d) => ({ duration_minutes: d }));

describe("normalizePace", () => {
  it("passes valid paces through and defaults the rest to moderate", () => {
    expect(normalizePace("relaxed")).toBe("relaxed");
    expect(normalizePace("active")).toBe("active");
    expect(normalizePace("moderate")).toBe("moderate");
    expect(normalizePace(undefined)).toBe("moderate");
    expect(normalizePace("banana")).toBe("moderate");
  });

  it('maps the legacy "packed" value (GenerateMoreDaysParams) to active', () => {
    expect(normalizePace("packed")).toBe("active");
  });
});

describe("sumPlannedMinutes", () => {
  it("sums durations and treats missing/invalid values as 0", () => {
    expect(sumPlannedMinutes(acts(60, 90, 30))).toBe(180);
    expect(sumPlannedMinutes(acts(60, null, undefined, -5, 30))).toBe(90);
    expect(sumPlannedMinutes([])).toBe(0);
    expect(sumPlannedMinutes(null)).toBe(0);
  });
});

describe("isOverpacked", () => {
  it("flags a day 25%+ over the time budget", () => {
    // moderate budget 480 → threshold 600. 3×210 = 630 minutes.
    expect(isOverpacked(acts(210, 210, 210), "moderate")).toBe(true);
    // Exactly at the threshold is NOT overpacked (soft ceiling).
    expect(isOverpacked(acts(300, 300), "moderate")).toBe(false);
  });

  it("flags a day two activities past the pace target (busy-day parity)", () => {
    // moderate target 4 → 6 short activities are still overpacked by count.
    expect(isOverpacked(acts(30, 30, 30, 30, 30, 30), "moderate")).toBe(true);
    expect(isOverpacked(acts(30, 30, 30, 30, 30), "moderate")).toBe(false);
  });

  it("scales with pace: the same day reads differently on relaxed vs active", () => {
    const day = acts(120, 120, 120, 120); // 8h, 4 activities
    expect(isOverpacked(day, "relaxed")).toBe(true); // 8h > 6h×1.25
    expect(isOverpacked(day, "active")).toBe(false); // 8h < 10h×1.25, 4 < 7
  });
});

describe("paceBudgetPromptClause", () => {
  it("quantifies each pace with its target count and hour budget", () => {
    for (const pace of ["relaxed", "moderate", "active"] as const) {
      const clause = paceBudgetPromptClause(pace);
      expect(clause).toContain(`~${PACE_BUDGETS[pace].targetActivities} activities/day`);
      expect(clause).toContain(`${Math.round(PACE_BUDGETS[pace].maxActivityMinutes / 60)} hours`);
    }
  });

  it("normalizes unknown input instead of throwing", () => {
    expect(paceBudgetPromptClause("packed")).toBe(paceBudgetPromptClause("active"));
    expect(paceBudgetPromptClause("")).toBe(paceBudgetPromptClause("moderate"));
  });
});
