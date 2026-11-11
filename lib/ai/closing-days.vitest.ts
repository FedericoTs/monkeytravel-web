import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Plans sent people to sights on the day they close: Seville's fine-arts
 * museum on a Monday, the Uffizi on a Monday, Topkapı on a Tuesday. Asked about
 * one place at a time the model knows these days; writing a whole plan it
 * doesn't. So the plan's places are asked about after it is written, and its
 * days reordered around their closing days.
 */

let answer: () => Promise<{ response: { text: () => string; usageMetadata?: object } }>;
const generateContent = vi.fn((_question: string) => answer());
vi.mock("@/lib/ai/gemini-call", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/gemini-call")>()),
  genAI: { getGenerativeModel: () => ({ generateContent }) },
}));

import { askClosingDays, keepOffClosingDays, orderAroundClosings, placesToAsk, shutStops, type Closings } from "./closing-days";

type Stop = [name: string, type: string];
const day = (n: number, date: string, stops: Stop[]) => ({
  day_number: n,
  date,
  theme: `theme ${n}`,
  activities: stops.map(([name, type]) => ({ name, type })),
});
const closings = (entries: Array<[string, string[]]>): Closings =>
  new Map(entries.map(([name, days]) => [name.toLowerCase(), days as never]));
const names = (days: Array<{ activities: Array<{ name: string }> }>) => days.map((d) => d.activities.map((a) => a.name).join("+"));

// Saturday 28 November to Monday 30 November 2026.
const seville = () => [
  day(1, "2026-11-28", [["Real Alcázar", "attraction"], ["Bar El Comercio", "restaurant"]]),
  day(2, "2026-11-29", [["Plaza de España", "landmark"]]),
  day(3, "2026-11-30", [["Museo de Bellas Artes", "museum"]]),
];

afterEach(() => {
  vi.unstubAllEnvs();
  generateContent.mockClear();
});

describe("ordering the days around closing days", () => {
  it("moves a day whose sight is shut on its weekday to a day it is open, each date keeping its place", () => {
    const days = orderAroundClosings(seville(), closings([["Museo de Bellas Artes", ["Monday"]]]));
    expect(names(days)).toEqual(["Real Alcázar+Bar El Comercio", "Museo de Bellas Artes", "Plaza de España"]);
    expect(days.map((d) => [d.day_number, d.date])).toEqual([
      [1, "2026-11-28"],
      [2, "2026-11-29"],
      [3, "2026-11-30"],
    ]);
    expect(days[1].theme).toBe("theme 3");
  });

  // Saturday 28 November to Tuesday 1 December.
  const fourDays = () => [
    day(1, "2026-11-28", [["Real Alcázar", "attraction"]]),
    day(2, "2026-11-29", [["Plaza de España", "landmark"]]),
    day(3, "2026-11-30", [["Museo de Bellas Artes", "museum"]]),
    day(4, "2026-12-01", [["Casa de Pilatos", "attraction"]]),
  ];

  it("keeps the first and last days in place when another order is as good", () => {
    // The museum could go to Sunday or to the last day, Tuesday.
    const days = orderAroundClosings(fourDays(), closings([["Museo de Bellas Artes", ["Monday"]]]));
    expect(names(days)).toEqual(["Real Alcázar", "Museo de Bellas Artes", "Plaza de España", "Casa de Pilatos"]);
  });

  it("moves as few days as it can", () => {
    // Sunday's square and Monday's museum are both shut on Sunday, so those two can't simply trade places.
    const days = fourDays();
    const shut = closings([["Plaza de España", ["Sunday"]], ["Museo de Bellas Artes", ["Sunday"]]]);
    const ordered = orderAroundClosings(days, shut);
    expect(shutStops(ordered, shut)).toBe(0);
    expect(ordered.filter((d, i) => d.theme !== days[i].theme)).toHaveLength(2);
  });

  it("leaves the days as they are when no order does better", () => {
    // Sunday to Tuesday in Florence, and each day is built around a museum shut on Monday.
    const days = [
      day(1, "2026-11-29", [["Uffizi Gallery", "museum"]]),
      day(2, "2026-11-30", [["Galleria dell'Accademia", "museum"]]),
      day(3, "2026-12-01", [["Palazzo Pitti", "museum"]]),
    ];
    const shut = closings([["Uffizi Gallery", ["Monday"]], ["Galleria dell'Accademia", ["Monday"]], ["Palazzo Pitti", ["Monday"]]]);
    expect(orderAroundClosings(days, shut)).toBe(days);
  });

  it("leaves a day with a dated event on its date", () => {
    const days = seville();
    days[1].activities = [{ name: "Flamenco night", type: "event" }];
    const ordered = orderAroundClosings(days, closings([["Museo de Bellas Artes", ["Monday"]]]));
    expect(names(ordered)).toEqual(["Museo de Bellas Artes", "Flamenco night", "Real Alcázar+Bar El Comercio"]);
  });

  it("fixes a longer trip by swapping days", () => {
    // Nine days from Monday 30 November: both Mondays start with a museum shut on Mondays.
    const date = (i: number) => new Date(Date.UTC(2026, 10, 30 + i)).toISOString().slice(0, 10);
    const days = Array.from({ length: 9 }, (_, i) => day(i + 1, date(i), [[`Sight ${i + 1}`, "attraction"]]));
    days[0].activities = [{ name: "Uffizi Gallery", type: "museum" }];
    days[7].activities = [{ name: "Galleria dell'Accademia", type: "museum" }];
    const shut = closings([["Uffizi Gallery", ["Monday"]], ["Galleria dell'Accademia", ["Monday"]]]);
    expect(shutStops(days, shut)).toBe(2);
    const ordered = orderAroundClosings(days, shut);
    expect(shutStops(ordered, shut)).toBe(0);
    expect(ordered.map((d) => d.date)).toEqual(days.map((d) => d.date));
    expect(names(ordered).sort()).toEqual(names(days).sort());
  });
});

describe("the places asked about", () => {
  it("are the plan's sights and markets, each once, not its meals", () => {
    const days = seville();
    days[2].activities.push({ name: "Real Alcázar ", type: "attraction" }, { name: "El Rinconcillo", type: "restaurant" });
    expect(placesToAsk(days)).toEqual(["Real Alcázar", "Plaza de España", "Museo de Bellas Artes"]);
  });
});

describe("the question", () => {
  it("reads each place's closing days by its number, weekdays only", async () => {
    vi.stubEnv("GOOGLE_AI_API_KEY", "test-key");
    answer = async () => ({
      response: {
        text: () =>
          JSON.stringify({
            places: [
              { n: 1, closed: ["Monday"] },
              { n: 2, closed: [] },
              { n: 3, closed: ["Sunday", "Someday"] },
              { n: 9, closed: ["Tuesday"] },
            ],
          }),
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 40 },
      },
    });
    const { closings: found, costUsd } = await askClosingDays("Seville", ["Museo de Bellas Artes", "Plaza de España", "Mercado de Triana"]);
    expect([...found]).toEqual([
      ["museo de bellas artes", ["Monday"]],
      ["mercado de triana", ["Sunday"]],
    ]);
    expect(costUsd).toBeGreaterThan(0);
    expect(generateContent.mock.calls[0][0]).toContain("1. Museo de Bellas Artes\n2. Plaza de España\n3. Mercado de Triana");
  });

  it("is not asked without a key, and a failed one changes nothing", async () => {
    vi.stubEnv("GOOGLE_AI_API_KEY", "");
    expect((await askClosingDays("Seville", ["Museo de Bellas Artes"])).closings.size).toBe(0);
    expect(generateContent).not.toHaveBeenCalled();

    vi.stubEnv("GOOGLE_AI_API_KEY", "test-key");
    answer = async () => {
      throw new Error("503");
    };
    expect(await askClosingDays("Seville", ["Museo de Bellas Artes"])).toEqual({ closings: new Map(), costUsd: 0 });
  });
});

describe("a plan kept off its closing days", () => {
  it("comes back reordered, with what was asked and found", async () => {
    const plan = { destination: { name: "Seville" }, days: seville() };
    const ask = vi.fn(async () => ({ closings: closings([["Museo de Bellas Artes", ["Monday"]]]), costUsd: 0.0004 }));
    const result = await keepOffClosingDays(plan, "Seville", ask);
    expect(ask).toHaveBeenCalledWith("Seville", ["Real Alcázar", "Plaza de España", "Museo de Bellas Artes"]);
    expect(names(result.itinerary.days)[1]).toBe("Museo de Bellas Artes");
    expect(result).toMatchObject({ costUsd: 0.0004, asked: 3, shutBefore: 1, shutAfter: 0 });
    expect(result.itinerary.destination).toBe(plan.destination);
  });

  it("is the same plan when nothing is shut", async () => {
    const plan = { days: seville() };
    const result = await keepOffClosingDays(plan, "Seville", async () => ({ closings: new Map(), costUsd: 0 }));
    expect(result.itinerary).toBe(plan);
  });
});
