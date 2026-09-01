/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { adjustItineraryDates } from "./cache";
import { canGroundDestination } from "../maps-grounding";
import { itineraryTimeoutMs } from "../gemini";
import type { GeneratedItinerary } from "@/types";

/**
 * Guards for the "one in five itineraries is silently short" defect.
 *
 * Measured 2026-09-01 across 428 saved trips: 93 (21.7%) held FEWER days than
 * their own date range and 0 held more — strictly one-directional, so
 * truncation rather than noise. It scaled with length: 7d 6% short, 10d 70%,
 * 14d 90%. Two of the wizard's five one-tap presets therefore failed most of
 * the time, and the result header still showed the full requested date range
 * beside the smaller day count, so nobody noticed.
 *
 * There were FOUR independent causes. These cover the parts that are pure
 * functions; the cache-lookup and Maps-Grounding fallbacks are exercised
 * end-to-end by scripts/probe-itinerary-completeness.mjs.
 */

function itinerary(days: number): GeneratedItinerary {
  return {
    destination: { name: "Test", country: "TS", description: "" },
    days: Array.from({ length: days }, (_, i) => ({
      day_number: i + 1,
      date: `2026-11-${String(i + 1).padStart(2, "0")}`,
      theme: `Day ${i + 1}`,
      activities: [],
    })),
  } as unknown as GeneratedItinerary;
}

describe("a cached itinerary is sliced to the range asked for", () => {
  it("trims a longer entry rather than over-delivering", () => {
    // This is why serving a LONGER cache entry stays allowed: hit rate for
    // short trips is preserved and the caller still gets exactly its range.
    const out = adjustItineraryDates(itinerary(14), "2026-11-01", "2026-11-05");
    expect(out.days).toHaveLength(5);
    expect(out.days[0].date).toBe("2026-11-01");
    expect(out.days[4].date).toBe("2026-11-05");
  });

  it("renumbers days from 1 so a sliced entry is coherent", () => {
    const out = adjustItineraryDates(itinerary(14), "2026-11-01", "2026-11-03");
    expect(out.days.map((d) => d.day_number)).toEqual([1, 2, 3]);
  });

  it("CANNOT invent days a short entry does not have", () => {
    // The reason the cache lookup must reject too-short entries: nothing
    // downstream backfills them. A 5-day entry answering a 14-day request
    // simply produced a 5-day trip, which is exactly what users got.
    const out = adjustItineraryDates(itinerary(5), "2026-11-01", "2026-11-14");
    expect(out.days.length).toBe(5);
    expect(out.days.length).toBeLessThan(14);
  });
});

describe("the generation timeout scales with trip length", () => {
  it("leaves short trips on the original 50s guard", () => {
    expect(itineraryTimeoutMs(3)).toBe(50_000);
    expect(itineraryTimeoutMs(7)).toBe(50_000);
  });

  it("gives a 14-day trip materially longer", () => {
    // A flat 50s ceiling made a 14-day request time out, retry, time out again
    // and return a 500 — while the same length for another city finished in
    // 26s. Slow must not be turned into broken.
    expect(itineraryTimeoutMs(14)).toBeGreaterThan(50_000);
  });

  it("never exceeds the route's 120s Vercel budget", () => {
    for (const days of [8, 14, 30, 365]) {
      expect(itineraryTimeoutMs(days)).toBeLessThanOrEqual(90_000);
    }
  });

  it("is monotonic in trip length", () => {
    const values = [5, 8, 10, 12, 14].map(itineraryTimeoutMs);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
    }
  });

  it("falls back to the base guard when length is unknown", () => {
    expect(itineraryTimeoutMs(undefined)).toBe(50_000);
  });
});

describe("Maps Grounding is skipped for places it cannot locate", () => {
  it("recognises a destination in its table", () => {
    expect(canGroundDestination("Paris, France")).toBe(true);
  });

  it("rejects one it does not know, instead of silently using Paris", () => {
    // The old resolver returned PARIS coordinates for anything unknown, then
    // spent 40s+ grounding zero places and produced an itinerary anchored to
    // the wrong city. Measured on a Valencia request:
    // "[MapsGrounding] Unknown destination: Valencia, Spain, using Paris
    // coordinates" followed by "0 places grounded in 43963ms".
    expect(canGroundDestination("Nowherecity, Atlantis")).toBe(false);
  });
});
