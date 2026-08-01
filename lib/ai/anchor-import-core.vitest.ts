import { describe, it, expect } from "vitest";
import {
  coerceAnchorDate,
  coerceAnchorTime,
  coerceAnchorType,
  normalizeImportedAnchors,
} from "./anchor-import-core";
import { MAX_ANCHORS, segmentTrip, validateAnchors } from "./anchors-core";

const START = "2026-09-08";
const END = "2026-09-15"; // 8 days

describe("coerceAnchorType", () => {
  it("passes through exact union members", () => {
    expect(coerceAnchorType("lodging", "whatever")).toBe("lodging");
    expect(coerceAnchorType("TRANSPORT", "x")).toBe("transport");
  });
  it("infers from the model's loose type string", () => {
    expect(coerceAnchorType("flight", "x")).toBe("transport");
    expect(coerceAnchorType("hotel", "x")).toBe("lodging");
  });
  it("infers from the TITLE when type is missing — how people actually write", () => {
    expect(coerceAnchorType(undefined, "Fly to Venice")).toBe("transport");
    expect(coerceAnchorType(undefined, "Wedding in Trieste")).toBe("event");
    expect(coerceAnchorType(undefined, "Night in Trieste")).toBe("lodging");
    expect(coerceAnchorType(undefined, "Meet Alyssa at the station")).toBe("meetup");
  });
  it("falls back to custom", () => {
    expect(coerceAnchorType(undefined, "Something vague")).toBe("custom");
    expect(coerceAnchorType(42, "Something vague")).toBe("custom");
  });
});

describe("coerceAnchorDate", () => {
  it("accepts ISO inside the range", () => {
    expect(coerceAnchorDate("2026-09-11", START, 8)).toBe("2026-09-11");
  });
  it("accepts day numbers — the dominant paste format", () => {
    expect(coerceAnchorDate("Day 1", START, 8)).toBe("2026-09-08");
    expect(coerceAnchorDate("day 4:", START, 8)).toBe("2026-09-11");
    expect(coerceAnchorDate("d3", START, 8)).toBe("2026-09-10");
    expect(coerceAnchorDate(3, START, 8)).toBe("2026-09-10");
    expect(coerceAnchorDate("8", START, 8)).toBe("2026-09-15");
  });
  it("rejects impossible + out-of-bounds + junk", () => {
    expect(coerceAnchorDate("2026-02-30", START, 8)).toBeNull();
    expect(coerceAnchorDate("Day 99", START, 8)).toBeNull();
    expect(coerceAnchorDate("Day 0", START, 8)).toBeNull();
    expect(coerceAnchorDate("sometime next week", START, 8)).toBeNull();
    expect(coerceAnchorDate("", START, 8)).toBeNull();
    expect(coerceAnchorDate(null, START, 8)).toBeNull();
  });
});

describe("coerceAnchorTime", () => {
  it("parses clock times and derives the slot", () => {
    expect(coerceAnchorTime("09:40")).toEqual({ slot: "morning", startTime: "09:40" });
    expect(coerceAnchorTime("14:00")).toEqual({ slot: "afternoon", startTime: "14:00" });
    expect(coerceAnchorTime("19:30")).toEqual({ slot: "evening", startTime: "19:30" });
    expect(coerceAnchorTime("9pm")).toEqual({ slot: "evening", startTime: "21:00" });
    expect(coerceAnchorTime("12 am")).toEqual({ slot: "morning", startTime: "00:00" });
  });
  it("parses word slots", () => {
    expect(coerceAnchorTime("all day")).toEqual({ slot: "all_day" });
    expect(coerceAnchorTime("in the morning")).toEqual({ slot: "morning" });
    expect(coerceAnchorTime("dinner")).toEqual({ slot: "evening" });
  });
  it("returns empty on junk", () => {
    expect(coerceAnchorTime("whenever")).toEqual({});
    expect(coerceAnchorTime(undefined)).toEqual({});
    expect(coerceAnchorTime("99:99")).toEqual({});
  });
});

describe("normalizeImportedAnchors — the Italy paste", () => {
  // What a real user pastes, as the extractor would hand it back: mixed
  // date formats, missing types, loose times.
  const raw = [
    { date: "Day 1", title: "Land at Venice Marco Polo", time: "09:40", location: "Venice Marco Polo Airport" },
    { date: "day 2", title: "Alyssa arrives", type: "meetup", location: "Venice" },
    { date: "2026-09-11", title: "Night in Trieste", type: "hotel", location: "Trieste" },
    { date: "Day 5", title: "Wedding", type: "event", time: "all day", location: "Trieste" },
    { date: "2026-09-15", title: "Fly home", type: "flight" },
  ];
  const { anchors, dropped } = normalizeImportedAnchors(raw, { startDate: START, endDate: END });

  it("imports every well-formed item", () => {
    expect(anchors).toHaveLength(5);
    expect(dropped).toEqual([]);
  });

  it("resolves day numbers against the trip start", () => {
    expect(anchors[0].date).toBe("2026-09-08");
    expect(anchors[3].date).toBe("2026-09-12");
  });

  it("maps loose types onto the union", () => {
    expect(anchors.map((a) => a.type)).toEqual([
      "transport", "meetup", "lodging", "event", "transport",
    ]);
  });

  it("splits time into slot + start_time, and never slots lodging", () => {
    expect(anchors[0].time_slot).toBe("morning");
    expect(anchors[0].start_time).toBe("09:40");
    expect(anchors[2].time_slot).toBeUndefined(); // lodging
    expect(anchors[3].time_slot).toBe("all_day");
  });

  it("produces a set the existing F1 machinery accepts and can segment", () => {
    expect(() => validateAnchors(START, END, anchors)).not.toThrow();
    const layout = segmentTrip(START, END, anchors);
    expect(layout.totalDays).toBe(8);
    // Sep 11 lodging must constrain where that day ends.
    expect(layout.days[3].endNear?.label).toBe("Trieste");
  });
});

describe("normalizeImportedAnchors — degradation (never throw, always valid)", () => {
  it("drops items with no title", () => {
    const { anchors, dropped } = normalizeImportedAnchors(
      [{ date: "Day 1", location: "Venice" }],
      { startDate: START, endDate: END }
    );
    expect(anchors).toHaveLength(0);
    expect(dropped[0]).toEqual({ title: "Venice", reason: "no_title" });
  });

  it("drops unparseable and out-of-range dates separately", () => {
    const { anchors, dropped } = normalizeImportedAnchors(
      [
        { date: "next tuesday", title: "Vague thing" },
        { date: "2026-12-25", title: "Christmas" },
      ],
      { startDate: START, endDate: END }
    );
    expect(anchors).toHaveLength(0);
    expect(dropped.map((d) => d.reason)).toEqual(["unparseable_date", "date_out_of_range"]);
  });

  it("drops exact duplicates but keeps same-title-different-day", () => {
    const { anchors, dropped } = normalizeImportedAnchors(
      [
        { date: "Day 2", title: "Wedding" },
        { date: "Day 2", title: "wedding" }, // case-insensitive dupe
        { date: "Day 3", title: "Wedding" }, // different day → keep
      ],
      { startDate: START, endDate: END }
    );
    expect(anchors).toHaveLength(2);
    expect(dropped[0].reason).toBe("duplicate");
  });

  it("keeps only the first lodging per night — the rule that would 400", () => {
    const { anchors, dropped } = normalizeImportedAnchors(
      [
        { date: "Day 2", title: "Hotel Aurora", type: "hotel", location: "Trieste" },
        { date: "Day 2", title: "Airbnb near port", type: "hotel", location: "Trieste" },
      ],
      { startDate: START, endDate: END }
    );
    expect(anchors).toHaveLength(1);
    expect(anchors[0].title).toBe("Hotel Aurora");
    expect(dropped[0].reason).toBe("second_lodging_same_night");
    // The guarantee: this would have THROWN if both were kept.
    expect(() => validateAnchors(START, END, anchors)).not.toThrow();
  });

  it("caps at MAX_ANCHORS and reports the overflow", () => {
    const many = Array.from({ length: MAX_ANCHORS + 3 }, (_, i) => ({
      date: "Day 1",
      title: `Thing ${i}`,
    }));
    const { anchors, dropped } = normalizeImportedAnchors(many, {
      startDate: START,
      endDate: END,
    });
    expect(anchors).toHaveLength(MAX_ANCHORS);
    expect(dropped.filter((d) => d.reason === "over_limit")).toHaveLength(3);
    expect(() => validateAnchors(START, END, anchors)).not.toThrow();
  });

  it("survives garbage input shapes without throwing", () => {
    for (const junk of [null, undefined, "a string", 42, {}, [null, 3, "x"]]) {
      expect(() => normalizeImportedAnchors(junk, { startDate: START, endDate: END })).not.toThrow();
    }
    expect(normalizeImportedAnchors(null, { startDate: START, endDate: END }).anchors).toEqual([]);
  });

  it("emits unique ids even from a messy list", () => {
    const { anchors } = normalizeImportedAnchors(
      [
        { date: "Day 1", title: "A" },
        { date: "bad", title: "B" },
        { date: "Day 2", title: "C" },
      ],
      { startDate: START, endDate: END }
    );
    const ids = anchors.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(() => validateAnchors(START, END, anchors)).not.toThrow();
  });

  it("truncates overlong text instead of rejecting it", () => {
    const { anchors } = normalizeImportedAnchors(
      [{ date: "Day 1", title: "x".repeat(400), location: "y".repeat(400), notes: "z".repeat(900) }],
      { startDate: START, endDate: END }
    );
    expect(anchors[0].title.length).toBe(120);
    expect(anchors[0].location!.length).toBe(160);
    expect(anchors[0].notes!.length).toBe(500);
    expect(() => validateAnchors(START, END, anchors)).not.toThrow();
  });
});
