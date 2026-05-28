import { describe, it, expect } from "vitest";
import { getTripDestination } from "./destination";

describe("getTripDestination", () => {
  describe("Source 1: meta.destination (canonical)", () => {
    it("returns meta.destination when present and non-empty", () => {
      expect(
        getTripDestination({ title: "Rome Trip", meta: { destination: "Rome" } }),
      ).toBe("Rome");
    });

    it("trims whitespace from meta.destination", () => {
      expect(
        getTripDestination({ title: "x", meta: { destination: "  Tokyo  " } }),
      ).toBe("Tokyo");
    });

    it("also accepts trip_meta (server-side row shape)", () => {
      expect(
        getTripDestination({ title: "x", trip_meta: { destination: "Lisbon" } }),
      ).toBe("Lisbon");
    });

    it("prefers meta.destination over a custom title", () => {
      // Wizard wrote "Rome" into meta; user later renamed the trip to "Honeymoon".
      // We should NOT show "Honeymoon" as the destination — the canonical value
      // is "Rome". Renaming is a display-only concern; destination is data.
      expect(
        getTripDestination({ title: "Honeymoon", meta: { destination: "Rome" } }),
      ).toBe("Rome");
    });
  });

  describe("Source 2: title-strip fallback", () => {
    it("strips ' Trip' suffix from English titles", () => {
      expect(getTripDestination({ title: "Rome Trip" })).toBe("Rome");
    });

    it("strips suffix case-insensitively", () => {
      expect(getTripDestination({ title: "Tokyo TRIP" })).toBe("Tokyo");
    });

    it("returns full title when there is no ' Trip' suffix", () => {
      // Italian title, no English suffix to strip. Pre-fix, this returned
      // the same string. Post-fix, behaviour is identical (no destination
      // in meta, so we still fall back to the title). The real value of
      // the fix is when meta.destination IS set.
      expect(getTripDestination({ title: "Viaggio a Roma" })).toBe("Viaggio a Roma");
    });

    it("returns the title when only the word 'Trip' would remain", () => {
      // Edge case: title is just "Trip" — stripping leaves empty string,
      // so we return the original title instead of "".
      expect(getTripDestination({ title: "Trip" })).toBe("Trip");
    });
  });

  describe("Source 3: empty / missing", () => {
    it("returns 'Unknown' for null/undefined/empty title with no meta", () => {
      expect(getTripDestination({})).toBe("Unknown");
      expect(getTripDestination({ title: null })).toBe("Unknown");
      expect(getTripDestination({ title: "" })).toBe("Unknown");
      expect(getTripDestination({ title: "   " })).toBe("Unknown");
    });

    it("ignores empty meta.destination and falls back to title", () => {
      expect(
        getTripDestination({ title: "Rome Trip", meta: { destination: "" } }),
      ).toBe("Rome");
    });

    it("ignores whitespace-only meta.destination", () => {
      expect(
        getTripDestination({ title: "Tokyo Trip", meta: { destination: "   " } }),
      ).toBe("Tokyo");
    });

    it("ignores non-string meta.destination defensively", () => {
      // trip_meta is JSONB — anything could be in there. Tolerate gracefully.
      expect(
        getTripDestination({
          title: "Paris Trip",
          // @ts-expect-error — exercising defensive runtime behaviour
          meta: { destination: 42 },
        }),
      ).toBe("Paris");
    });
  });

  describe("Source priority", () => {
    it("meta.destination wins over trip_meta.destination", () => {
      expect(
        getTripDestination({
          title: "x",
          meta: { destination: "A" },
          trip_meta: { destination: "B" },
        }),
      ).toBe("A");
    });
  });
});
