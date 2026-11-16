import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The closing-day check moves a day's contents to another date. Words written
 * for the old date ("Vatican City and Christmas Day" now on the 24th) are
 * re-worded for the new one, and only those.
 */

let answer: () => Promise<{ response: { text: () => string; usageMetadata?: object } }>;
const generateContent = vi.fn((_question: string) => answer());
vi.mock("@/lib/ai/gemini-call", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/gemini-call")>()),
  genAI: { getGenerativeModel: () => ({ generateContent }) },
}));

import { hasDatedWords, rewordMovedDays } from "./moved-day-words";

const reply = (texts: Array<{ n: number; text: string }>) => async () => ({
  response: { text: () => JSON.stringify({ texts }), usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 40 } },
});

type Stop = { name: string; type: string; description: string; tips?: string[] };
type Day = { day_number: number; date: string; theme: string; activities: Stop[] };

// Rome, Thursday 24 to Saturday 26 December 2026: the Vatican day was written for the 25th and now falls on the 24th;
// the market day came from the 24th; the 26th didn't move.
const rome = (): Day[] => [
  {
    day_number: 1,
    date: "2026-12-24",
    theme: "Vatican City and Christmas Day",
    activities: [
      { name: "Vatican Museums", type: "museum", description: "Michelangelo's ceiling.", tips: ["Go early", "Book online"] },
      {
        name: "Ristorante L'Arcangelo",
        type: "restaurant",
        description: "A Roman lunch. Reservations are essential for Christmas day.",
        tips: ["Cash is fine", "Ask for the Christmas menu"],
      },
    ],
  },
  { day_number: 2, date: "2026-12-25", theme: "Local flavours", activities: [{ name: "Trastevere", type: "landmark", description: "Lanes." }] },
  { day_number: 3, date: "2026-12-26", theme: "Santo Stefano stroll", activities: [{ name: "Piazza Navona", type: "landmark", description: "Fountains." }] },
];
const moves = [
  { slot: 0, from: "2026-12-25" },
  { slot: 1, from: "2026-12-24" },
];

afterEach(() => {
  vi.unstubAllEnvs();
  generateContent.mockClear();
});

describe("words tied to a date", () => {
  it("are weekdays and the holidays the closing check asks about, in the four languages", () => {
    for (const text of [
      "Vatican City and Christmas Day",
      "Start your Sunday at the market",
      "Cena della Vigilia a Trastevere",
      "Una domenica al mercato",
      "Pranzo di Natale",
      "Nochevieja en la Puerta del Sol",
      "El jueves, mercado",
      "Réveillon em Copacabana",
      "Quinta-feira no Chiado",
      "Museums and New Year's Eve panorama",
      "Thanksgiving parade",
      "Museum Masterpieces & NYE Traditions",
      "Hogmanay in the Old Town",
      "St. Stephen's Day walk",
      "Hatsumode at Meiji Jingu",
      "Shōgatsu lunch",
      "Oshogatsu foods",
      "Ōmisoka soba in Asakusa",
      "Omisoka bells",
    ]) {
      expect(hasDatedWords(text), text).toBe(true);
    }
    for (const text of ["Old town and the river", "The smartest way in", "Nyerere Road", "Mercato Centrale", "Quinta da Regaleira", "Fondation Louis Vuitton", "", undefined]) {
      expect(hasDatedWords(text), String(text)).toBe(false);
    }
  });
});

describe("re-wording moved days", () => {
  it("asks nothing when no moved day has such words", async () => {
    vi.stubEnv("GOOGLE_AI_API_KEY", "test-key");
    const days = rome();
    days[0].theme = "Vatican City";
    days[0].activities[1].description = "A Roman lunch.";
    days[0].activities[1].tips = ["Cash is fine"];
    const result = await rewordMovedDays(days, moves, "Rome");
    expect(generateContent).not.toHaveBeenCalled();
    expect(result).toEqual({ days, costUsd: 0, reworded: 0 });
    expect(result.days).toBe(days);
  });

  it("asks nothing without a key", async () => {
    vi.stubEnv("GOOGLE_AI_API_KEY", "");
    const days = rome();
    expect((await rewordMovedDays(days, moves, "Rome")).days).toBe(days);
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("re-words a moved day's theme, description and tip for its new date, and nothing else", async () => {
    vi.stubEnv("GOOGLE_AI_API_KEY", "test-key");
    answer = reply([
      { n: 1, text: "Vatican City on Christmas Eve" },
      { n: 2, text: "A Roman lunch. Reservations are essential on Christmas Eve." },
      { n: 3, text: "Ask for the Christmas Eve menu" },
    ]);
    const days = rome();
    const before = JSON.stringify(days);
    const result = await rewordMovedDays(days, moves, "Rome");

    const question = generateContent.mock.calls[0][0];
    expect(question).toContain("trip to Rome");
    expect(question).toContain("1. (was Friday 2026-12-25, now Thursday 2026-12-24) Vatican City and Christmas Day");
    expect(question).toContain("3. (was Friday 2026-12-25, now Thursday 2026-12-24) Ask for the Christmas menu");
    // The day that didn't move, a place's name, and words with no date in them are not asked about.
    expect(question).not.toContain("Santo Stefano");
    expect(question).not.toContain("Arcangelo");
    expect(question).not.toContain("Cash is fine");

    expect(result.days[0].theme).toBe("Vatican City on Christmas Eve");
    expect(result.days[0].activities[1].description).toBe("A Roman lunch. Reservations are essential on Christmas Eve.");
    expect(result.days[0].activities[1].tips).toEqual(["Cash is fine", "Ask for the Christmas Eve menu"]);
    expect(result.days[0].activities[0]).toEqual(days[0].activities[0]);
    expect(result.days[1]).toBe(days[1]);
    expect(result.days[2]).toBe(days[2]);
    expect(result.reworded).toBe(3);
    expect(result.costUsd).toBeGreaterThan(0);
    // The plan it was given is left as it was.
    expect(JSON.stringify(days)).toBe(before);
  });

  it("writes a text on one line in the question", async () => {
    vi.stubEnv("GOOGLE_AI_API_KEY", "test-key");
    answer = reply([]);
    const days = rome();
    days[0].theme = "Vatican City\nand Christmas Day";
    await rewordMovedDays(days, moves, "Rome");
    expect(generateContent.mock.calls[0][0]).toContain(") Vatican City and Christmas Day");
  });

  it("keeps a text when the answer is empty, the same, far longer, or for no text it was asked", async () => {
    vi.stubEnv("GOOGLE_AI_API_KEY", "test-key");
    answer = reply([
      { n: 1, text: "  " },
      { n: 2, text: "A Roman lunch. Reservations are essential for Christmas day." },
      { n: 3, text: "x".repeat(200) },
      { n: 9, text: "Something else" },
    ]);
    const days = rome();
    const result = await rewordMovedDays(days, moves, "Rome");
    expect(result.days).toBe(days);
    expect(result.reworded).toBe(0);
    expect(result.costUsd).toBeGreaterThan(0);
  });

  it("leaves the words as they were when the question fails", async () => {
    vi.stubEnv("GOOGLE_AI_API_KEY", "test-key");
    answer = async () => {
      throw new Error("503");
    };
    const days = rome();
    expect(await rewordMovedDays(days, moves, "Rome")).toEqual({ days, costUsd: 0, reworded: 0 });
  });

  it("skips a move it can't date", async () => {
    vi.stubEnv("GOOGLE_AI_API_KEY", "test-key");
    const days = rome();
    expect((await rewordMovedDays(days, [{ slot: 0 }, { slot: 7, from: "2026-12-25" }], "Rome")).days).toBe(days);
    expect(generateContent).not.toHaveBeenCalled();
  });
});
