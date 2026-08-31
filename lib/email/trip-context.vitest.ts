/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import {
  buildContextBlocks,
  FORECAST_SLOTS,
  stripInventedWeatherRationale,
  type ContextLabels,
} from "./trip-context";
import { forecastMessage, formatTempRange } from "./trip-forecast";

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
  // Pre-formatted and localised by the caller, straight from Open-Meteo.
  forecastLine: "22–32°C · no rain expected",
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
  it("pack_early_14d gets the real forecast AND the packing list", () => {
    const blocks = buildContextBlocks("pack_early_14d", FULL, L);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].label).toBe(L.weather);
    expect(blocks[0].note).toBe("22–32°C · no rain expected");
    expect(blocks[1].label).toBe(L.packing);
    expect(blocks[1].items?.[0].text).toBe("Light rain jacket");
  });

  it("weather_3d renders the forecast, and nothing else", () => {
    const blocks = buildContextBlocks("weather_3d", FULL, L);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].label).toBe(L.weather);
    expect(blocks[0].note).toBe("22–32°C · no rain expected");
  });

  it("weather_3d renders NOTHING when the forecast is unavailable", () => {
    // No coordinates, a timeout, dates past the 16-day horizon — the lookup
    // returns null and the email goes out bare rather than guessing.
    const { forecastLine, ...noForecast } = FULL;
    expect(buildContextBlocks("weather_3d", noForecast, L)).toEqual([]);
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
    // Index 1 — the forecast block precedes it again, now that it is real.
    const packing = buildContextBlocks("pack_early_14d", FULL, L)[1];
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

  it("returns nothing for pack_early_14d when neither source is available", () => {
    expect(buildContextBlocks("pack_early_14d", {}, L)).toEqual([]);
  });

  it("renders the forecast alone when there is no packing list", () => {
    const blocks = buildContextBlocks("pack_early_14d", { forecastLine: "5–9°C" }, L);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].label).toBe(L.weather);
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

  it("treats a blank or whitespace forecast as absent", () => {
    expect(buildContextBlocks("weather_3d", { forecastLine: "   " }, L)).toEqual([]);
    expect(buildContextBlocks("weather_3d", { forecastLine: "" }, L)).toEqual([]);
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
    // FULL carries weatherNote as well as forecastLine. The heading may now
    // appear — backed by the forecast — but the invented prose must not.
    const blocks = buildContextBlocks(slot, { ...FULL }, L);
    for (const b of blocks) {
      expect(b.note ?? "", `${slot} rendered the invented note`).not.toContain(
        "mild spring weather"
      );
    }
  });

  it("ignores weatherNote even when it is the ONLY source", () => {
    // The strongest form: hand it nothing but the invented note and every
    // slot must still come back empty.
    for (const slot of ["pack_early_14d", "weather_3d", "confirm_1d", "morning_of"]) {
      expect(
        buildContextBlocks(slot, { weatherNote: "Expect cool temperatures (10-18°C)" }, L),
        slot
      ).toEqual([]);
    }
  });
});

describe("FORECAST_SLOTS matches the switch it describes", () => {
  // The cron and the audit script both gate their Open-Meteo call on this
  // set, so a slot that drifts out of step with the switch below either pays
  // for a forecast nothing reads, or renders a weather block with no weather
  // in it. Neither is visible without this test.
  const ALL_SLOTS = [
    "pack_early_14d",
    "visa_check_7d",
    "weather_3d",
    "confirm_1d",
    "morning_of",
    "followup_return_3d",
    "followup_next_21d",
    "followup_final_45d",
    "followup_dormant",
  ];

  const LINE = "18–24°C · rain on 2 of 5 days";

  it.each(ALL_SLOTS)("%s renders the forecast iff it is in the set", (slot) => {
    const rendered = JSON.stringify(
      buildContextBlocks(slot, { ...FULL, forecastLine: LINE }, L)
    ).includes(LINE);
    expect(rendered).toBe(FORECAST_SLOTS.has(slot));
  });

  it("names only real slots", () => {
    for (const slot of FORECAST_SLOTS) expect(ALL_SLOTS).toContain(slot);
  });
});

describe("forecastMessage", () => {
  const base = { minC: 18, maxC: 24, days: 5, firstDay: null };

  it("picks the dry sentence when no day is wet", () => {
    // "rain on 0 of 5 days" is a worse sentence than "no rain expected", and
    // the two-message split only survives if this branch is asserted.
    expect(forecastMessage({ ...base, wetDays: 0 })).toEqual({
      key: "weatherNoRain",
      values: { range: "18–24°C", wet: 0, days: 5 },
    });
  });

  it("picks the wet sentence and carries both counts", () => {
    expect(forecastMessage({ ...base, wetDays: 2 })).toEqual({
      key: "weatherWithRain",
      values: { range: "18–24°C", wet: 2, days: 5 },
    });
  });
});

describe("formatTempRange", () => {
  it("uses a tight en dash between positives", () => {
    expect(formatTempRange(22, 32)).toBe("22–32°C");
  });

  it("spaces the dash when an endpoint is negative", () => {
    // Found by rendering the real copy: a tight dash beside a minus sign
    // produced "-8–-1°C", which every winter trip would have shipped.
    expect(formatTempRange(-8, -1)).toBe("-8 – -1°C");
    expect(formatTempRange(-3, 4)).toBe("-3 – 4°C");
  });

  it("collapses an identical pair to one figure", () => {
    // A one-day forecast produces this pair often; "3–3°C" is not a range.
    expect(formatTempRange(3, 3)).toBe("3°C");
    expect(formatTempRange(-1, -1)).toBe("-1°C");
  });
});

describe("packing suggestions must not argue with the forecast", () => {
  /**
   * pack_early_14d renders the real forecast and the packing list one above
   * the other. The forecast is now measured; the packing list is still model
   * output from generation time. Measured 2026-08-31: of 13 queued trips whose
   * packing list made a one-way weather claim AND whose forecast could be
   * checked, 2 were contradicted by it — e.g. a Tokyo trip forecast at 19-35°C
   * carrying "Layered clothing (cool autumn weather)".
   *
   * Every string below is verbatim from the production corpus of 954 packing
   * items across the queued packing emails.
   */

  it.each([
    // the exact shape from the report: a bare weather noun-phrase
    ["Layered clothing (cool autumn weather)", "Layered clothing"],
    ["Light, breathable clothing (summer weather)", "Light, breathable clothing"],
    ["Rain jacket or umbrella (unpredictable weather)", "Rain jacket or umbrella"],
    // justifications, parenthesised
    ["Hat, gloves, and scarf (for cooler evenings)", "Hat, gloves, and scarf"],
    ["Rain jacket or umbrella (for potential light rain)", "Rain jacket or umbrella"],
    ["Layered clothing (temperatures can vary)", "Layered clothing"],
    ["Sunscreen and hat (even in autumn)", "Sunscreen and hat"],
    ["Light layers for varying temperatures (autumn in Santorini)", "Light layers"],
    // justifications, unparenthesised
    ["Layered clothing for cool autumn weather", "Layered clothing"],
    ["Scarf and gloves for chilly evenings", "Scarf and gloves"],
    ["Light waterproof jacket/umbrella for spring showers", "Light waterproof jacket/umbrella"],
    // the generator writes in the reader's language
    ["Abbigliamento a strati per temperature variabili", "Abbigliamento a strati"],
  ])("strips the reasoning from %j", (input, expected) => {
    expect(stripInventedWeatherRationale(input)).toBe(expected);
  });

  it.each([
    // A parenthetical that SPECIFIES the item is not a weather claim, even
    // when it names weather — it says what to bring, not what the sky will do.
    "Rain protection (umbrella or light rain jacket)",
    "Warm layers (sweaters, fleece)",
    "Layers of thermal clothing (base, mid-layer)",
    "Comfortable walking shoes (waterproof if possible)",
    // A reason about scenery contradicts no forecast.
    "Camera for stunning winter landscapes and architecture",
    "Camera to capture the fall foliage",
    "Red light flashlight (for stargazing)",
    // The item's own name may contain a season.
    "Warm winter coat",
    "Warm, waterproof winter coat",
  ])("leaves %j alone", (input) => {
    expect(stripInventedWeatherRationale(input)).toBe(input);
  });

  it("never empties an item, whatever the input", () => {
    // Verified across all 954 production items: 132 shortened, 0 emptied. A
    // rule that can delete an item would silently shrink the packing block.
    for (const s of [
      "(for cool weather)",
      "for warm weather",
      "(temperatures vary)",
      "weather",
      "   ",
    ]) {
      expect(stripInventedWeatherRationale(s).length).toBeGreaterThan(0);
    }
  });

  it("reaches the rendered packing block, not just the helper", () => {
    const blocks = buildContextBlocks(
      "pack_early_14d",
      {
        forecastLine: "19–35°C · no rain expected",
        packingSuggestions: [
          "Layered clothing (cool autumn weather)",
          "Warm layers (sweaters, fleece)",
        ],
      },
      L
    );
    const packing = blocks.find((b) => b.label === L.packing)!;
    expect(packing.items?.[0].text).toBe("Layered clothing");
    expect(packing.items?.[1].text).toBe("Warm layers (sweaters, fleece)");
    // And the forecast above it is untouched.
    expect(blocks.find((b) => b.label === L.weather)?.note).toBe("19–35°C · no rain expected");
  });
});
