import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * A plan for Kashmir in December sent people to the Zoji La pass and the Amarnath trail, both shut by snow all winter.
 * The closing question asks about a place's own closing days and leaves seasons out, so the season has its own.
 */

let answer: () => Promise<{ response: { text: () => string; usageMetadata?: object } }>;
const generateContent = vi.fn((_question: string) => answer());
vi.mock("@/lib/ai/gemini-call", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/gemini-call")>()),
  genAI: { getGenerativeModel: () => ({ generateContent }) },
}));

import { askSeasonalClosings, placesForTheSeason, seasonQuestion, tripDates, withSeasonalClosings } from "./seasonal-closings";

describe("placesForTheSeason", () => {
  it("asks about the plan's sights and outdoor stops, each once, not its meals, rides, hotel, shops or nights out", () => {
    const days = [
      {
        activities: [
          { name: "Zoji La Pass", type: "attraction" },
          { name: "Baltal Restaurant", type: "restaurant" },
          { name: "Taxi to Sonamarg", type: "transport" },
          { name: "Hotel Snowland", type: "accommodation" },
        ],
      },
      {
        activities: [
          { name: "Sheshnag Lake Trail", type: "nature" },
          { name: " Zoji La Pass ", type: "landmark" },
          { name: "Lal Chowk Market", type: "shopping" },
          { name: "Café de Linz", type: "cafe" },
          { name: "Pub night", type: "nightlife" },
          { name: "Shankaracharya Temple", type: "landmark" },
          { type: "nature" },
        ],
      },
    ];
    expect(placesForTheSeason(days)).toEqual(["Zoji La Pass", "Sheshnag Lake Trail", "Shankaracharya Temple"]);
  });

  it("asks about forty at most", () => {
    const days = [{ activities: Array.from({ length: 45 }, (_, i) => ({ name: `Trail ${i + 1}`, type: "nature" })) }];
    expect(placesForTheSeason(days)).toHaveLength(40);
  });
});

describe("tripDates", () => {
  it("lists the trip's dates in order, each once", () => {
    expect(tripDates([{ date: "2026-12-18" }, { date: "2026-12-17" }, { date: "2026-12-18" }, {}, { date: "soon" }])).toEqual([
      "2026-12-17",
      "2026-12-18",
    ]);
  });
});

describe("seasonQuestion", () => {
  it("names the place, the dates, what counts as open, and each place by number", () => {
    const question = seasonQuestion("Kashmir, India", ["Zoji La Pass", "Dal Lake"], "2026-12-14", "2026-12-23");
    expect(question).toContain("Which of these places in Kashmir, India can't be visited at any time from 2026-12-14 to 2026-12-23,");
    expect(question).toContain("a road or place open all year, and a slope or meadow open for skiing or sledging, are open");
    expect(question.split("\n").slice(-2)).toEqual(["1. Zoji La Pass", "2. Dal Lake"]);
    expect(seasonQuestion("Kashmir", ["Dal Lake"], "2026-12-14", "2026-12-14")).toContain("can't be visited on 2026-12-14,");
  });
});

describe("askSeasonalClosings", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    generateContent.mockClear();
  });

  it("gives the places the model numbers as shut, by name", async () => {
    vi.stubEnv("GOOGLE_AI_API_KEY", "test");
    answer = async () => ({ response: { text: () => JSON.stringify({ shut: [1, 3, 9, 1.5, "2"] }) } });
    const { shut } = await askSeasonalClosings("Kashmir, India", ["Zoji La Pass", "Dal Lake", "Sheshnag Lake Trail"], ["2026-12-18"]);
    expect([...shut]).toEqual(["zoji la pass", "sheshnag lake trail"]);
    expect(generateContent.mock.calls[0][0]).toContain("can't be visited on 2026-12-18,");
  });

  it("asks over the trip's first and last dates", async () => {
    vi.stubEnv("GOOGLE_AI_API_KEY", "test");
    answer = async () => ({ response: { text: () => JSON.stringify({ shut: [] }) } });
    await askSeasonalClosings("Kashmir, India", ["Dal Lake"], ["2026-12-14", "2026-12-15", "2026-12-23"]);
    expect(generateContent.mock.calls[0][0]).toContain("at any time from 2026-12-14 to 2026-12-23,");
  });

  it("asks nothing without places, dates or a key, and gives none when the question fails", async () => {
    vi.stubEnv("GOOGLE_AI_API_KEY", "test");
    expect((await askSeasonalClosings("Kashmir", [], ["2026-12-18"])).shut.size).toBe(0);
    expect((await askSeasonalClosings("Kashmir", ["Dal Lake"], [])).shut.size).toBe(0);
    expect(generateContent).not.toHaveBeenCalled();
    answer = async () => {
      throw new Error("timeout");
    };
    expect((await askSeasonalClosings("Kashmir", ["Zoji La Pass"], ["2026-12-18"])).shut.size).toBe(0);
    answer = async () => ({ response: { text: () => "not json" } });
    expect((await askSeasonalClosings("Kashmir", ["Zoji La Pass"], ["2026-12-18"])).shut.size).toBe(0);
    vi.stubEnv("GOOGLE_AI_API_KEY", "");
    generateContent.mockClear();
    expect((await askSeasonalClosings("Kashmir", ["Zoji La Pass"], ["2026-12-18"])).shut.size).toBe(0);
    expect(generateContent).not.toHaveBeenCalled();
  });
});

describe("withSeasonalClosings", () => {
  it("shuts each place on every date of the trip, keeping the dates it had", () => {
    const before = new Map([
      ["zoji la pass", ["2026-12-25"]],
      ["dal lake", ["2026-12-25"]],
    ]);
    const after = withSeasonalClosings(before, new Set(["zoji la pass", "sheshnag lake trail"]), ["2026-12-17", "2026-12-18"], "Kashmir, India");
    expect(after.get("zoji la pass")).toEqual(["2026-12-17", "2026-12-18", "2026-12-25"]);
    expect(after.get("sheshnag lake trail")).toEqual(["2026-12-17", "2026-12-18"]);
    expect(after.get("dal lake")).toEqual(["2026-12-25"]);
    expect(before.get("zoji la pass")).toEqual(["2026-12-25"]);
  });

  it("leaves a place on the checked list to the list, and the map as it was when nothing is shut", () => {
    const before = new Map<string, string[]>();
    expect(withSeasonalClosings(before, new Set(["tower of london"]), ["2026-12-17"], "London, United Kingdom")).toBe(before);
    expect(withSeasonalClosings(before, new Set(), ["2026-12-17"], "Kashmir")).toBe(before);
    expect(withSeasonalClosings(before, new Set(["zoji la pass"]), [], "Kashmir")).toBe(before);
  });
});
