/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { buildContextBlocks, type ContextLabels } from "./trip-context";

/**
 * The input here is model-generated jsonb straight out of trips.trip_meta and
 * trips.itinerary. This codebase already has a production incident from
 * trusting that shape — `estimated_cost` was declared required, Gemini omitted
 * it, and `activity.estimated_cost.amount` threw 17 times on /trips/:id
 * (Sentry JAVASCRIPT-NEXTJS-12).
 *
 * So the bar is not "handles the happy path". It is: given ANY jsonb, either
 * produce a clean block or produce nothing, and never throw — because the
 * caller is a cron whose real job is delivering the reminder, and an
 * enrichment crash would take the reminder with it.
 */

const L: ContextLabels = {
  weather: "Weather while you're there",
  packing: "Worth packing",
  goingFor: "What you're going for",
  dayOne: "Day one",
  today: "Today's plan",
  yourHighlights: "Your highlights",
};

// Shaped like the real row measured in production (a Paris trip).
const FULL = {
  weatherNote:
    "Expect mild spring weather with temperatures ranging from 10°C to 20°C, occasional rain.",
  highlights: [
    "Exploring the artistic treasures of the Louvre Museum.",
    "Enjoying a romantic Seine River cruise at sunset.",
    "Wandering through Montmartre at golden hour.",
    "A fourth highlight that should be cut.",
  ],
  packingSuggestions: ["Light rain jacket", "Comfortable shoes", "Adapter", "Scarf", "Fifth"],
  day1: {
    day_number: 1,
    theme: "Arrival and the Right Bank",
    activities: [
      { name: "Louvre Museum", start_time: "09:30" },
      { name: "Le Fumoir", start_time: "13:00" },
      { name: "Walk through Tuileries Garden", start_time: "15:00" },
      { name: "A fourth activity that should be cut", start_time: "19:00" },
    ],
  },
};

describe("slot → block mapping", () => {
  it("pack_early_14d gets the packing list, and NOT the weather note", () => {
    // The weather note used to lead this block. It is model-invented — Kyoto
    // in September came out as both 10-18C and 27-32C on different trips — so
    // it is no longer rendered anywhere. See trip-context.ts for the evidence.
    const blocks = buildContextBlocks("pack_early_14d", FULL, L);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].label).toBe(L.packing);
    expect(blocks[0].items?.[0].text).toBe("Light rain jacket");
  });

  it("weather_3d renders NO block at all", () => {
    // Its entire enrichment was the weather note, so it now has none. The
    // email still reads correctly: the body says "Peek at the weather", it
    // never claimed to state the weather.
    expect(buildContextBlocks("weather_3d", FULL, L)).toEqual([]);
  });

  it("confirm_1d and morning_of both show day one, under different headings", () => {
    const confirm = buildContextBlocks("confirm_1d", FULL, L);
    const morning = buildContextBlocks("morning_of", FULL, L);
    expect(confirm[0].label).toBe(L.dayOne);
    expect(morning[0].label).toBe(L.today);
    // Same content, different framing — that is the whole point.
    expect(confirm[0].items).toEqual(morning[0].items);
    expect(morning[0].items?.[0]).toEqual({ text: "Louvre Museum", meta: "09:30" });
  });

  it("followup_return_3d recaps the highlights", () => {
    const blocks = buildContextBlocks("followup_return_3d", FULL, L);
    expect(blocks[0].label).toBe(L.yourHighlights);
    expect(blocks[0].items?.length).toBe(3);
  });

  it("the later followup slots stay bare", () => {
    // They exist to be short. A recap of a six-week-old trip works against
    // "we won't keep nudging".
    for (const slot of ["followup_next_21d", "followup_final_45d", "followup_dormant"]) {
      expect(buildContextBlocks(slot, FULL, L), slot).toEqual([]);
    }
  });

  it("an unknown slot gets nothing rather than a default block", () => {
    expect(buildContextBlocks("some_future_slot", FULL, L)).toEqual([]);
  });
});

describe("caps", () => {
  it("never returns more than two blocks", () => {
    for (const slot of ["pack_early_14d", "weather_3d", "morning_of"]) {
      expect(buildContextBlocks(slot, FULL, L).length).toBeLessThanOrEqual(2);
    }
  });

  it("caps lists — 3 items, 4 for packing", () => {
    expect(buildContextBlocks("visa_check_7d", FULL, L)[0].items).toHaveLength(3);
    expect(buildContextBlocks("morning_of", FULL, L)[0].items).toHaveLength(3);
    // Index 0 now, not 1 — the weather block that used to precede it is gone.
    const packing = buildContextBlocks("pack_early_14d", FULL, L)[0];
    expect(packing.items).toHaveLength(4);
  });

  it("truncates a runaway item on a word boundary", () => {
    // Formerly asserted on the weather note, which is no longer rendered.
    // The same truncation still guards every list item.
    const long = "word ".repeat(200);
    const blocks = buildContextBlocks("visa_check_7d", { highlights: [long] }, L);
    const text = blocks[0].items![0].text;
    expect(text.length).toBeLessThanOrEqual(81);
    expect(text.endsWith("…")).toBe(true);
    expect(text).not.toContain("wor…"); // did not cut mid-word
  });

  it("truncates a runaway item", () => {
    const blocks = buildContextBlocks(
      "visa_check_7d",
      { highlights: ["x".repeat(500)] },
      L
    );
    expect(blocks[0].items![0].text.length).toBeLessThanOrEqual(81);
  });
});

describe("graceful degradation — the common case, not an edge case", () => {
  it("returns nothing at all when the trip has no enrichment", () => {
    // 11% of trips have no weather_note, 30% no highlights.
    expect(buildContextBlocks("weather_3d", {}, L)).toEqual([]);
    expect(buildContextBlocks("visa_check_7d", {}, L)).toEqual([]);
    expect(buildContextBlocks("morning_of", {}, L)).toEqual([]);
  });

  it("returns nothing for pack_early_14d when there is no packing list", () => {
    // A weather note alone no longer produces a block, so this slot is empty
    // rather than falling back to it.
    expect(
      buildContextBlocks("pack_early_14d", { weatherNote: "Cold and bright." }, L)
    ).toEqual([]);
  });

  it("keeps the packing block when only the weather is missing", () => {
    const blocks = buildContextBlocks(
      "pack_early_14d",
      { packingSuggestions: ["Boots"] },
      L
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].label).toBe(L.packing);
  });

  it("treats a blank or whitespace note as absent", () => {
    expect(buildContextBlocks("weather_3d", { weatherNote: "   " }, L)).toEqual([]);
    expect(buildContextBlocks("weather_3d", { weatherNote: "" }, L)).toEqual([]);
  });
});

describe("defensive parsing — arbitrary jsonb must not throw", () => {
  const JUNK: unknown[] = [
    null,
    undefined,
    42,
    "a string where an array belongs",
    {},
    [],
    [null, undefined, 7, {}, []],
    { activities: "not an array" },
    { activities: [null, 5, "str", {}] },
    [{ deeply: { nested: true } }],
  ];

  it("survives junk in every field for every slot", () => {
    const slots = [
      "pack_early_14d",
      "visa_check_7d",
      "weather_3d",
      "confirm_1d",
      "morning_of",
      "followup_return_3d",
    ];
    for (const slot of slots) {
      for (const junk of JUNK) {
        expect(() =>
          buildContextBlocks(slot, {
            weatherNote: junk,
            highlights: junk,
            packingSuggestions: junk,
            day1: junk,
          }, L)
        , `${slot} / ${JSON.stringify(junk)}`).not.toThrow();
      }
    }
  });

  it("skips activities with no usable name", () => {
    // Gemini omits fields. An activity without a name is not renderable.
    const blocks = buildContextBlocks(
      "morning_of",
      {
        day1: {
          activities: [
            { start_time: "09:00" },
            { name: "   ", start_time: "10:00" },
            { name: "Real Place", start_time: "11:00" },
          ],
        },
      },
      L
    );
    expect(blocks[0].items).toEqual([{ text: "Real Place", meta: "11:00" }]);
  });

  it("falls back from start_time to time_slot, and omits meta when neither exists", () => {
    const blocks = buildContextBlocks(
      "morning_of",
      {
        day1: {
          activities: [
            { name: "Timed", start_time: "09:00" },
            { name: "Slotted", time_slot: "afternoon" },
            { name: "Bare" },
          ],
        },
      },
      L
    );
    expect(blocks[0].items).toEqual([
      { text: "Timed", meta: "09:00" },
      { text: "Slotted", meta: "afternoon" },
      { text: "Bare" },
    ]);
  });

  it("de-duplicates repeated list entries case-insensitively", () => {
    const blocks = buildContextBlocks(
      "visa_check_7d",
      { highlights: ["Louvre", "louvre", "LOUVRE", "Seine cruise"] },
      L
    );
    expect(blocks[0].items?.map((i) => i.text)).toEqual(["Louvre", "Seine cruise"]);
  });

  it("filters non-string list entries instead of rendering [object Object]", () => {
    const blocks = buildContextBlocks(
      "visa_check_7d",
      { highlights: [{ a: 1 }, 42, null, "Real highlight"] },
      L
    );
    expect(blocks[0].items).toEqual([{ text: "Real highlight" }]);
  });
});

describe("the weather note is never rendered, in any slot", () => {
  it.each([
    "pack_early_14d",
    "visa_check_7d",
    "weather_3d",
    "confirm_1d",
    "morning_of",
    "followup_return_3d",
  ])("%s emits no block containing the weather note", (slot) => {
    // Guards the removal itself. trip_meta.weather_note is invented rather
    // than measured — Kyoto/September appears as both 10-18C and 27-32C, and
    // Tokyo/November comes out hotter than Tokyo/September. A reminder email
    // is the worst place for that, because people pack from it.
    const blocks = buildContextBlocks(slot, FULL, L);
    for (const b of blocks) {
      expect(b.label, `${slot} rendered the weather heading`).not.toBe(L.weather);
      expect(b.note ?? "", `${slot} rendered the weather note`).not.toContain(
        "mild spring weather"
      );
    }
  });
});
