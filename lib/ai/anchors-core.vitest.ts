import { describe, it, expect } from "vitest";
import type { GeneratedItinerary, ItineraryDay, TripAnchor, Activity } from "@/types";
import {
  AnchorError,
  MAX_ANCHORS,
  anchorToActivity,
  buildLockedDay,
  buildSegmentBrief,
  effectiveSlot,
  haversineKm,
  inclusiveDaySpan,
  mergeAnchoredItinerary,
  segmentTrip,
  validateAnchors,
  validateMergedItinerary,
} from "./anchors-core";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function anchor(partial: Partial<TripAnchor> & Pick<TripAnchor, "id" | "date" | "type" | "title">): TripAnchor {
  return { ...partial };
}

/**
 * THE acceptance fixture — Federico's real Italy trip (plan §5):
 * land Venice Sep 8, Alyssa arrives Sep 9, night of Sep 11 MUST be Trieste,
 * Sep 12 wedding, Sep 13 family day, Sep 14 Venice sleeping near Mestre
 * station, Sep 15 fly out.
 */
const TRIP_START = "2026-09-08";
const TRIP_END = "2026-09-15";
const VCE = { lat: 45.5053, lng: 12.3519 };
const TRIESTE = { lat: 45.6495, lng: 13.7768 };
const MESTRE = { lat: 45.4825, lng: 12.2313 };

const ITALY_ANCHORS: TripAnchor[] = [
  anchor({ id: "a1", date: "2026-09-08", type: "transport", time_slot: "morning", start_time: "09:40", title: "Land at Venice Marco Polo", location: "Venice Marco Polo Airport", place: VCE }),
  anchor({ id: "a2", date: "2026-09-09", type: "meetup", time_slot: "morning", title: "Alyssa arrives", location: "Venice" }),
  anchor({ id: "a3", date: "2026-09-11", type: "lodging", title: "Night in Trieste", location: "Trieste", place: TRIESTE }),
  anchor({ id: "a4", date: "2026-09-12", type: "event", title: "Wedding", location: "Trieste" }),
  anchor({ id: "a5", date: "2026-09-13", type: "event", title: "Family & friends day", location: "Trieste" }),
  anchor({ id: "a6", date: "2026-09-14", type: "lodging", title: "Sleep near Mestre station", location: "Venice Mestre", place: MESTRE }),
  anchor({ id: "a7", date: "2026-09-15", type: "transport", title: "Fly home", location: "Venice Marco Polo Airport" }),
];

function act(partial: Partial<Activity> & Pick<Activity, "time_slot" | "name">): Activity {
  return {
    start_time: "10:00",
    duration_minutes: 90,
    type: "attraction",
    description: "",
    location: "",
    estimated_cost: { amount: 10, currency: "EUR", tier: "budget" },
    tips: [],
    booking_required: false,
    ...partial,
  };
}

function segResult(days: ItineraryDay[], cost = 100): GeneratedItinerary {
  return {
    destination: {
      name: "Venice",
      country: "Italy",
      description: "Canals",
      best_for: ["Culture"],
      weather_note: "Mild",
    },
    days,
    trip_summary: {
      total_estimated_cost: cost,
      currency: "EUR",
      highlights: ["h"],
      packing_suggestions: ["shoes"],
    },
  };
}

// ---------------------------------------------------------------------------
// validateAnchors
// ---------------------------------------------------------------------------

describe("validateAnchors", () => {
  it("accepts the Italy fixture", () => {
    expect(() => validateAnchors(TRIP_START, TRIP_END, ITALY_ANCHORS)).not.toThrow();
  });

  it("rejects malformed dates strictly (the 1J lesson)", () => {
    // 5-digit year, slash format, impossible calendar date — all must throw,
    // never silently pass via the lenient legacy Date parser.
    for (const bad of ["20226-09-08", "2026/09/08", "2026-02-30", "2026-9-8"]) {
      expect(() =>
        validateAnchors(TRIP_START, TRIP_END, [anchor({ id: "x", date: bad, type: "event", title: "T" })])
      ).toThrow(AnchorError);
    }
  });

  it("rejects anchors outside the trip range", () => {
    expect(() =>
      validateAnchors(TRIP_START, TRIP_END, [anchor({ id: "x", date: "2026-09-16", type: "event", title: "T" })])
    ).toThrow(/outside the trip/);
  });

  it("rejects duplicate ids", () => {
    expect(() =>
      validateAnchors(TRIP_START, TRIP_END, [
        anchor({ id: "dup", date: "2026-09-09", type: "event", title: "A" }),
        anchor({ id: "dup", date: "2026-09-10", type: "event", title: "B" }),
      ])
    ).toThrow(/duplicate anchor id/);
  });

  it("rejects two overnight stays on the same date", () => {
    expect(() =>
      validateAnchors(TRIP_START, TRIP_END, [
        anchor({ id: "l1", date: "2026-09-10", type: "lodging", title: "Hotel A", location: "X" }),
        anchor({ id: "l2", date: "2026-09-10", type: "lodging", title: "Hotel B", location: "Y" }),
      ])
    ).toThrow(/only end in one place/);
  });

  it("rejects bad start_time, bad slot, out-of-range coords, over-caps", () => {
    const base = { id: "x", date: "2026-09-10", type: "event" as const, title: "T" };
    expect(() => validateAnchors(TRIP_START, TRIP_END, [anchor({ ...base, start_time: "25:00" })])).toThrow(/HH:MM/);
    expect(() =>
      validateAnchors(TRIP_START, TRIP_END, [anchor({ ...base, time_slot: "night" as never })])
    ).toThrow(/time_slot/);
    expect(() =>
      validateAnchors(TRIP_START, TRIP_END, [anchor({ ...base, place: { lat: 91, lng: 0 } })])
    ).toThrow(/coordinates/);
    const tooMany = Array.from({ length: MAX_ANCHORS + 1 }, (_, i) =>
      anchor({ id: `a${i}`, date: "2026-09-10", type: "event", time_slot: "morning", title: `E${i}` })
    );
    expect(() => validateAnchors(TRIP_START, TRIP_END, tooMany)).toThrow(/at most/);
    expect(() => validateAnchors(TRIP_START, TRIP_END, [])).toThrow(/at least one anchor/);
  });
});

// ---------------------------------------------------------------------------
// effectiveSlot + basics
// ---------------------------------------------------------------------------

describe("effectiveSlot", () => {
  it("lodging is always evening — even if a slot was set", () => {
    expect(effectiveSlot(anchor({ id: "l", date: "2026-09-10", type: "lodging", title: "L", time_slot: "all_day" }))).toBe("evening");
  });
  it("non-lodging defaults to all_day", () => {
    expect(effectiveSlot(anchor({ id: "e", date: "2026-09-10", type: "event", title: "E" }))).toBe("all_day");
  });
});

describe("inclusiveDaySpan + haversineKm", () => {
  it("counts both endpoints", () => {
    expect(inclusiveDaySpan("2026-09-08", "2026-09-08")).toBe(1);
    expect(inclusiveDaySpan(TRIP_START, TRIP_END)).toBe(8);
  });
  it("Venice → Trieste is ~115km (sanity for the 60km end-near gate)", () => {
    const km = haversineKm(VCE.lat, VCE.lng, TRIESTE.lat, TRIESTE.lng);
    expect(km).toBeGreaterThan(100);
    expect(km).toBeLessThan(130);
  });
});

// ---------------------------------------------------------------------------
// segmentTrip — the Italy trip decomposes exactly as designed
// ---------------------------------------------------------------------------

describe("segmentTrip (Italy fixture)", () => {
  const layout = segmentTrip(TRIP_START, TRIP_END, ITALY_ANCHORS);

  it("classifies all 8 days", () => {
    expect(layout.totalDays).toBe(8);
    expect(layout.days.map((d) => d.kind)).toEqual([
      "partial", // Sep 8  — morning landing, plan the rest
      "partial", // Sep 9  — Alyssa arrives in the morning
      "free",    // Sep 10
      "partial", // Sep 11 — lodging only: full day plannable, must end Trieste
      "locked",  // Sep 12 — wedding
      "locked",  // Sep 13 — family day
      "partial", // Sep 14 — lodging near Mestre
      "locked",  // Sep 15 — fly home (all-day transport)
    ]);
  });

  it("lodging constrains the day's end without consuming slots", () => {
    const sep11 = layout.days[3];
    expect(sep11.freeSlots).toEqual(["morning", "afternoon", "evening"]);
    expect(sep11.endNear?.label).toBe("Trieste");
    expect(sep11.endNear?.lat).toBeCloseTo(TRIESTE.lat);
  });

  it("slot anchors free only the remaining slots", () => {
    expect(layout.days[0].freeSlots).toEqual(["afternoon", "evening"]);
  });

  it("builds two segments with the right geographic context", () => {
    expect(layout.segments).toHaveLength(2);
    const [s0, s1] = layout.segments;

    // Segment 0: Sep 8–11. Starts at the airport (same-day morning arrival),
    // must end in Trieste (the booked night).
    expect(s0.startDate).toBe("2026-09-08");
    expect(s0.endDate).toBe("2026-09-11");
    expect(s0.days).toHaveLength(4);
    expect(s0.startNear?.label).toBe("Venice Marco Polo Airport");
    expect(s0.mustEndNear?.label).toBe("Trieste");
    expect(s0.mustEndReason).toBe("Night in Trieste");

    // Segment 1: Sep 14 alone. Comes from Trieste (last located commitment),
    // must end near Mestre station (the booked night).
    expect(s1.startDate).toBe("2026-09-14");
    expect(s1.endDate).toBe("2026-09-14");
    expect(s1.startNear?.label).toBe("Trieste");
    expect(s1.mustEndNear?.label).toBe("Venice Mestre");
    expect(s1.mustEndReason).toBe("Sleep near Mestre station");
  });

  it("stamps segment membership on non-locked days", () => {
    expect(layout.days[2].segmentIndex).toBe(0);
    expect(layout.days[2].segmentDayIndex).toBe(2);
    expect(layout.days[6].segmentIndex).toBe(1);
    expect(layout.days[6].segmentDayIndex).toBe(0);
    expect(layout.days[4].segmentIndex).toBeUndefined();
  });
});

describe("segmentTrip (edges)", () => {
  it("a segment ending at a located locked day inherits its mustEndNear", () => {
    // 5-day trip, all-day event with a location on day 3 → segment 1 must
    // end near the event, segment 2 starts from it.
    const layout = segmentTrip("2026-09-08", "2026-09-12", [
      anchor({ id: "e", date: "2026-09-10", type: "event", title: "Concert", location: "Verona" }),
    ]);
    expect(layout.segments).toHaveLength(2);
    expect(layout.segments[0].mustEndNear?.label).toBe("Verona");
    expect(layout.segments[0].mustEndReason).toBe("Concert");
    expect(layout.segments[1].startNear?.label).toBe("Verona");
    expect(layout.segments[1].mustEndNear).toBeUndefined();
  });

  it("three slot anchors lock a day", () => {
    const layout = segmentTrip("2026-09-08", "2026-09-09", [
      anchor({ id: "m", date: "2026-09-08", type: "event", time_slot: "morning", title: "A" }),
      anchor({ id: "a", date: "2026-09-08", type: "event", time_slot: "afternoon", title: "B" }),
      anchor({ id: "e", date: "2026-09-08", type: "event", time_slot: "evening", title: "C" }),
    ]);
    expect(layout.days[0].kind).toBe("locked");
    expect(layout.segments).toHaveLength(1);
  });

  it("a fully locked trip has zero segments (zero LLM calls, $0)", () => {
    const layout = segmentTrip("2026-09-08", "2026-09-09", [
      anchor({ id: "d1", date: "2026-09-08", type: "event", title: "A" }),
      anchor({ id: "d2", date: "2026-09-09", type: "event", title: "B" }),
    ]);
    expect(layout.segments).toHaveLength(0);
    expect(layout.days.every((d) => d.kind === "locked")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildSegmentBrief
// ---------------------------------------------------------------------------

describe("buildSegmentBrief", () => {
  const layout = segmentTrip(TRIP_START, TRIP_END, ITALY_ANCHORS);

  it("carries day range, context, hard constraint and commitments", () => {
    const brief = buildSegmentBrief(layout.segments[0], layout.totalDays);
    expect(brief).toContain("days 1-4 of a 8-day trip");
    expect(brief).toContain("starts this stretch near Venice Marco Polo Airport");
    expect(brief).toContain("HARD CONSTRAINT");
    expect(brief).toContain("END in or near Trieste (Night in Trieste)");
    expect(brief).toContain("- 2026-09-08 (morning 09:40): Land at Venice Marco Polo");
    expect(brief).toContain("do NOT include them in your JSON output");
    expect(brief).toContain("[overnight stay: end this day near here]");
    expect(brief).toContain("On 2026-09-08 only plan the afternoon and evening slot(s).");
    // Lodging-only day: all three slots open, so no slot-restriction line.
    expect(brief).not.toContain("On 2026-09-11 only plan");
  });
});

// ---------------------------------------------------------------------------
// anchorToActivity + locked days
// ---------------------------------------------------------------------------

describe("anchorToActivity", () => {
  it("materializes a locked zero-cost activity", () => {
    const a = anchorToActivity(ITALY_ANCHORS[0], "EUR");
    expect(a.locked).toBe(true);
    expect(a.anchor_id).toBe("a1");
    expect(a.id).toBe("anchor-a1");
    expect(a.time_slot).toBe("morning");
    expect(a.start_time).toBe("09:40");
    expect(a.type).toBe("transport");
    expect(a.estimated_cost).toEqual({ amount: 0, currency: "EUR", tier: "free" });
    expect(a.coordinates).toEqual(VCE);
  });

  it("lodging defaults to a late evening check-in", () => {
    const a = anchorToActivity(ITALY_ANCHORS[2], "EUR");
    expect(a.time_slot).toBe("evening");
    expect(a.start_time).toBe("21:00");
    expect(a.type).toBe("lodging");
  });

  it("buildLockedDay contains only the anchors", () => {
    const layout = segmentTrip(TRIP_START, TRIP_END, ITALY_ANCHORS);
    const day = buildLockedDay(layout.days[4], "EUR"); // Sep 12 wedding
    expect(day.day_number).toBe(5);
    expect(day.date).toBe("2026-09-12");
    expect(day.title).toBe("Wedding");
    expect(day.activities).toHaveLength(1);
    expect(day.activities[0].locked).toBe(true);
  });

  it("buildLockedDay sets theme — the field every view actually renders", () => {
    // Caught on prod: the wizard result, trip detail, shared view, DaySlider
    // and OngoingTripView all read day.theme. Setting only `title` left the
    // wedding day with a blank subtitle while AI-filled days got one.
    const layout = segmentTrip(TRIP_START, TRIP_END, ITALY_ANCHORS);
    const day = buildLockedDay(layout.days[4], "EUR");
    expect(day.theme).toBe("Wedding");
  });
});

// ---------------------------------------------------------------------------
// mergeAnchoredItinerary + validateMergedItinerary
// ---------------------------------------------------------------------------

function italyMergeFixture() {
  const layout = segmentTrip(TRIP_START, TRIP_END, ITALY_ANCHORS);
  // Segment 0 (Sep 8–11): includes a rogue morning activity on Sep 8 that
  // overlaps the anchored landing slot — the merge must drop it.
  const seg0 = segResult(
    [
      {
        day_number: 1, date: "2026-09-08",
        activities: [
          act({ time_slot: "morning", name: "Rogue coffee", start_time: "08:00" }),
          act({ time_slot: "afternoon", name: "Rialto walk", coordinates: { lat: 45.438, lng: 12.336 } }),
          act({ time_slot: "evening", name: "Cicchetti dinner", start_time: "19:30", coordinates: { lat: 45.437, lng: 12.333 } }),
        ],
      },
      { day_number: 2, date: "2026-09-09", activities: [act({ time_slot: "afternoon", name: "Gondola" })] },
      { day_number: 3, date: "2026-09-10", activities: [act({ time_slot: "morning", name: "Prosecco hills", coordinates: { lat: 45.868, lng: 12.243 } })] },
      {
        day_number: 4, date: "2026-09-11",
        activities: [
          act({ time_slot: "morning", name: "Drive east" }),
          act({ time_slot: "evening", name: "Canal Grande di Trieste", start_time: "18:30", coordinates: { lat: 45.651, lng: 13.771 } }),
        ],
      },
    ],
    400
  );
  // Segment 1 (Sep 14): ends near Mestre as constrained.
  const seg1 = segResult(
    [
      {
        day_number: 1, date: "2026-09-14",
        activities: [
          act({ time_slot: "morning", name: "Venice old town", coordinates: { lat: 45.434, lng: 12.339 } }),
          act({ time_slot: "evening", name: "Dinner near Mestre station", start_time: "19:30", coordinates: { lat: 45.481, lng: 12.232 } }),
        ],
      },
    ],
    120
  );
  return { layout, results: [seg0, seg1] };
}

describe("mergeAnchoredItinerary (Italy fixture)", () => {
  const { layout, results } = italyMergeFixture();
  const { itinerary, issues } = mergeAnchoredItinerary(layout, results, {
    destinationLabel: "Venice & Friuli",
  });

  it("produces 8 sequential days numbered 1..8", () => {
    expect(itinerary.days).toHaveLength(8);
    expect(itinerary.days.map((d) => d.day_number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(itinerary.days.map((d) => d.date)).toEqual([
      "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11",
      "2026-09-12", "2026-09-13", "2026-09-14", "2026-09-15",
    ]);
  });

  it("locked days contain exactly their anchors", () => {
    const wedding = itinerary.days[4];
    expect(wedding.activities).toHaveLength(1);
    expect(wedding.activities[0].name).toBe("Wedding");
    expect(wedding.activities[0].locked).toBe(true);
    const flyHome = itinerary.days[7];
    expect(flyHome.activities.map((a) => a.anchor_id)).toEqual(["a7"]);
  });

  it("drops LLM activities that invade anchored slots and reports it", () => {
    const sep8 = itinerary.days[0];
    expect(sep8.activities.map((a) => a.name)).toEqual([
      "Land at Venice Marco Polo", // 09:40 anchor — rogue 08:00 coffee dropped
      "Rialto walk",
      "Cicchetti dinner",
    ]);
    expect(issues.some((i) => i.includes("2026-09-08"))).toBe(true);
  });

  it("inserts lodging as a late locked activity after dinner", () => {
    const sep11 = itinerary.days[3];
    const names = sep11.activities.map((a) => a.name);
    expect(names.indexOf("Night in Trieste")).toBeGreaterThan(names.indexOf("Canal Grande di Trieste"));
    expect(sep11.activities.find((a) => a.anchor_id === "a3")?.locked).toBe(true);
  });

  it("sums costs and merges summary fields", () => {
    expect(itinerary.trip_summary.total_estimated_cost).toBe(520);
    expect(itinerary.trip_summary.currency).toBe("EUR");
    expect(itinerary.destination.name).toBe("Venice");
  });

  it("passes post-merge validation (anchors intact + geography honoured)", () => {
    expect(validateMergedItinerary(layout, itinerary)).toEqual([]);
  });
});

describe("mergeAnchoredItinerary (degraded inputs)", () => {
  it("throws on result-count mismatch (caller bug)", () => {
    const { layout } = italyMergeFixture();
    expect(() => mergeAnchoredItinerary(layout, [], { destinationLabel: "X" })).toThrow(AnchorError);
  });

  it("a missing LLM day degrades to a light day with its anchors, plus an issue", () => {
    const { layout, results } = italyMergeFixture();
    const shortSeg1 = { ...results[1], days: [] };
    const { itinerary, issues } = mergeAnchoredItinerary(layout, [results[0], shortSeg1], {
      destinationLabel: "X",
    });
    const sep14 = itinerary.days[6];
    expect(sep14.activities.map((a) => a.anchor_id)).toEqual(["a6"]);
    expect(issues.some((i) => i.includes("2026-09-14"))).toBe(true);
  });

  it("a fully locked trip merges with zero LLM results", () => {
    const layout = segmentTrip("2026-09-08", "2026-09-09", [
      anchor({ id: "d1", date: "2026-09-08", type: "event", title: "A" }),
      anchor({ id: "d2", date: "2026-09-09", type: "event", title: "B" }),
    ]);
    const { itinerary, issues } = mergeAnchoredItinerary(layout, [], { destinationLabel: "Rome" });
    expect(issues).toEqual([]);
    expect(itinerary.destination.name).toBe("Rome");
    expect(itinerary.days).toHaveLength(2);
    expect(itinerary.days.every((d) => d.activities.every((a) => a.locked))).toBe(true);
  });
});

describe("validateMergedItinerary (violations)", () => {
  it("flags a day that should end in Trieste but ends in Venice", () => {
    const { layout, results } = italyMergeFixture();
    // Sabotage: last located Sep-11 activity is in Venice (~115km from Trieste).
    results[0].days[3].activities = [
      act({ time_slot: "evening", name: "Stuck in Venice", coordinates: { lat: 45.4408, lng: 12.3155 } }),
    ];
    const { itinerary } = mergeAnchoredItinerary(layout, results, { destinationLabel: "X" });
    const issues = validateMergedItinerary(layout, itinerary);
    expect(issues.some((i) => i.includes("Trieste") && i.includes("2026-09-11"))).toBe(true);
  });

  it("flags a missing anchor", () => {
    const { layout, results } = italyMergeFixture();
    const { itinerary } = mergeAnchoredItinerary(layout, results, { destinationLabel: "X" });
    const wedding = itinerary.days[4];
    wedding.activities = wedding.activities.filter((a) => a.anchor_id !== "a4");
    const issues = validateMergedItinerary(layout, itinerary);
    expect(issues.some((i) => i.includes("Wedding") && i.includes("missing"))).toBe(true);
  });
});
