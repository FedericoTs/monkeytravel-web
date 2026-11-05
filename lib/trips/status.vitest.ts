import { describe, expect, it } from "vitest";
import { isValidStatusTransition, shownTripStatus, tripTimeline } from "./status";

/**
 * A trip's row stores what its owner chose. That it's under way or over comes
 * from its dates, counted in calendar days: a trip is still on for all of its
 * last day, in any time zone.
 */

const TODAY = "2026-11-05";

describe("tripTimeline", () => {
  it.each([
    ["starts tomorrow", "2026-11-06", "2026-11-09", "upcoming"],
    ["starts today", "2026-11-05", "2026-11-09", "current"],
    ["is in its middle", "2026-11-03", "2026-11-09", "current"],
    ["ends today", "2026-11-01", "2026-11-05", "current"],
    ["is one day, today", "2026-11-05", "2026-11-05", "current"],
    ["ended yesterday", "2026-11-01", "2026-11-04", "past"],
    ["ended long ago", "2020-05-01", "2020-05-05", "past"],
  ])("a trip that %s", (_name, start, end, expected) => {
    expect(tripTimeline(start, end, TODAY)).toBe(expected);
  });

  it("reads a date with a time on it by its day", () => {
    expect(tripTimeline("2026-11-05T00:00:00+00:00", "2026-11-05T00:00:00+00:00", TODAY)).toBe("current");
  });
});

describe("shownTripStatus", () => {
  const FUTURE = ["2026-12-01", "2026-12-04"] as const;
  const NOW = ["2026-11-04", "2026-11-05"] as const;
  const OVER = ["2026-10-01", "2026-10-04"] as const;

  it.each(["planning", "confirmed"])("%s stays what the owner chose until the trip starts", (status) => {
    expect(shownTripStatus(status, ...FUTURE, TODAY)).toBe(status);
  });

  it.each(["planning", "confirmed"])("%s is under way between the dates", (status) => {
    expect(shownTripStatus(status, ...NOW, TODAY)).toBe("active");
  });

  it.each(["planning", "confirmed", "active"])("%s is over after them", (status) => {
    expect(shownTripStatus(status, ...OVER, TODAY)).toBe("completed");
  });

  it("a cancelled trip stays cancelled, whatever its dates", () => {
    for (const [start, end] of [FUTURE, NOW, OVER]) {
      expect(shownTripStatus("cancelled", start, end, TODAY)).toBe("cancelled");
    }
  });
});

describe("isValidStatusTransition", () => {
  it("lets the owner confirm, cancel and restore", () => {
    expect(isValidStatusTransition("planning", "confirmed")).toBe(true);
    expect(isValidStatusTransition("planning", "cancelled")).toBe(true);
    expect(isValidStatusTransition("confirmed", "planning")).toBe(true);
    expect(isValidStatusTransition("cancelled", "planning")).toBe(true);
  });

  it("refuses the rest", () => {
    expect(isValidStatusTransition("cancelled", "confirmed")).toBe(false);
    expect(isValidStatusTransition("completed", "planning")).toBe(false);
    expect(isValidStatusTransition("active", "planning")).toBe(false);
  });
});
