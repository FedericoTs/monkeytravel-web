import { describe, it, expect } from "vitest";
import {
  PACE_BUDGETS,
  isMealStop,
  isOverpacked,
  lightenDayRequest,
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

  it('maps the legacy "packed" value to active', () => {
    expect(normalizePace("packed")).toBe("active");
  });
});

describe("lightenDayRequest", () => {
  it("names the day, its stops and its hours", () => {
    expect(lightenDayRequest(3, acts(120, 200, 340))).toBe(
      "Day 3 has 3 stops and about 11 hours planned, which feels packed. Make it more relaxed."
    );
  });

  it("copes with a day that has no activities", () => {
    expect(lightenDayRequest(1, undefined)).toContain("Day 1 has 0 stops and about 0 hours");
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

  it("flags a day two sights and activities past the pace target, its meals not counted", () => {
    // moderate target 3 → 5 short activities are overpacked by count.
    expect(isOverpacked(acts(30, 30, 30, 30, 30), "moderate")).toBe(true);
    expect(isOverpacked(acts(30, 30, 30, 30), "moderate")).toBe(false);
    // Four sights with lunch and dinner is a full day, not a packed one.
    const meal = (type: string) => ({ duration_minutes: 60, type });
    expect(isOverpacked([...acts(60, 60, 60, 60), meal("restaurant"), meal("cafe")], "moderate")).toBe(false);
    expect(isOverpacked([...acts(60, 60, 60, 60), meal("museum")], "moderate")).toBe(true);
  });

  it("reads a meal from its type, however loosely the plan types it", () => {
    for (const type of ["restaurant", "food", "foodie", "cafe", "café", "bar", "Ristorante", "meal", "brunch"]) {
      expect(isMealStop({ type })).toBe(true);
    }
    for (const type of ["museum", "market", "barbershop", "landmark", "", null, undefined]) {
      expect(isMealStop({ type })).toBe(false);
    }
  });

  it("scales with pace: the same day reads differently on relaxed vs active", () => {
    const day = acts(120, 120, 120, 120); // 8h, 4 activities
    expect(isOverpacked(day, "relaxed")).toBe(true); // 8h > 6h×1.25
    expect(isOverpacked(day, "active")).toBe(false); // 8h < 10h×1.25, 4 < 7
  });
});

// A Paris day made more relaxed got its hotel night as a stop of ten hours, and the note then read "5 stops and
// about 17 hours planned": pressed again, there was nothing left to lighten.
describe("the time a day is busy", () => {
  const stop = (name: string, type: string, duration_minutes: number, extra: Record<string, unknown> = {}) => ({ name, type, duration_minutes, ...extra });
  const relaxedParisDay = [
    stop("Café Kitsuné", "cafe", 60),
    stop("Louvre Museum", "museum", 150),
    stop("Le Comptoir", "restaurant", 90),
    stop("Brasserie Lipp", "restaurant", 120),
    stop("Hôtel Lutetia", "accommodation", 600),
  ];

  it("leaves out a night at the hotel, however it is typed or named", () => {
    expect(sumPlannedMinutes(relaxedParisDay)).toBe(420);
    expect(sumPlannedMinutes([stop("Louvre Museum", "museum", 150), stop("Ryokan Sawaya", "hotel", 720)])).toBe(150);
    expect(sumPlannedMinutes([stop("Louvre Museum", "museum", 150), stop("Check-in at Hotel Lutetia", "", 600)])).toBe(150);
    // A sight with "Hotel" in its name is still a sight.
    expect(sumPlannedMinutes([stop("Hôtel de Ville", "landmark", 60)])).toBe(60);
  });

  it("leaves out the trip from the last city, and keeps a local ride", () => {
    const arrival = [stop("Flight to Florence", "transport", 270, { transport_mode: "flight" }), stop("Duomo", "landmark", 120)];
    expect(sumPlannedMinutes(arrival)).toBe(120);
    expect(sumPlannedMinutes([stop("Train to Versailles", "transport", 45), stop("Château de Versailles", "landmark", 240)])).toBe(285);
  });

  it("doesn't call that day packed, or count the hotel among its stops", () => {
    expect(isOverpacked(relaxedParisDay, "moderate")).toBe(false);
    expect(lightenDayRequest(1, relaxedParisDay)).toBe(
      "Day 1 has 4 stops and about 7 hours planned, which feels packed. Make it more relaxed."
    );
    // Four sights and the hotel: four sights and activities, one under packed for a moderate day.
    const fourSights = [...["Louvre", "Orsay", "Orangerie", "Rodin"].map((name) => stop(name, "museum", 60)), stop("Hôtel Lutetia", "accommodation", 60)];
    expect(isOverpacked(fourSights, "moderate")).toBe(false);
    // A long ride on the day isn't the day's own plan either.
    expect(isOverpacked([stop("Train to Jaisalmer", "transport", 750, { transport_mode: "train" }), stop("Gadisar Lake", "nature", 90)], "moderate")).toBe(false);
  });
});

describe("paceBudgetPromptClause", () => {
  it("quantifies each pace with its target count and hour budget", () => {
    for (const pace of ["relaxed", "moderate", "active"] as const) {
      const clause = paceBudgetPromptClause(pace);
      expect(clause).toContain(`~${PACE_BUDGETS[pace].targetActivities} sights and activities a day besides lunch and dinner`);
      expect(clause).toContain(`${Math.round(PACE_BUDGETS[pace].maxActivityMinutes / 60)} hours`);
    }
  });

  it("normalizes unknown input instead of throwing", () => {
    expect(paceBudgetPromptClause("packed")).toBe(paceBudgetPromptClause("active"));
    expect(paceBudgetPromptClause("")).toBe(paceBudgetPromptClause("moderate"));
  });
});
