import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Plans sent people to sights on the day they close: Seville's fine-arts
 * museum on a Monday, the Uffizi on a Monday, Topkapı on a Tuesday. Asked about
 * one place at a time the model knows these days; writing a whole plan it
 * doesn't. So the plan's places are asked about after it is written, and its
 * days reordered around their closing days. Holidays close sights whatever
 * their weekday (the Louvre on Christmas Day), so the plan's holiday dates are
 * asked about too.
 */

let answer: () => Promise<{ response: { text: () => string; usageMetadata?: object } }>;
const generateContent = vi.fn((_question: string) => answer());
let modelConfig: { generationConfig?: { responseSchema?: unknown } } | undefined;
vi.mock("@/lib/ai/gemini-call", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/gemini-call")>()),
  genAI: {
    getGenerativeModel: (config: typeof modelConfig) => {
      modelConfig = config;
      return { generateContent };
    },
  },
}));

import {
  askClosingDays,
  holidayDatesToAsk,
  keepOffClosingDays,
  moveShutStops,
  orderAroundClosings,
  placesToAsk,
  shutStops,
  type Closings,
  type ShutDates,
} from "./closing-days";
import type { Move, WordDay } from "./moved-day-words";

type Stop = [name: string, type: string];
const day = (n: number, date: string, stops: Stop[]) => ({
  day_number: n,
  date,
  theme: `theme ${n}`,
  activities: stops.map(([name, type]) => ({ name, type })),
});
const closings = (entries: Array<[string, string[]]>): Closings =>
  new Map(entries.map(([name, days]) => [name.toLowerCase(), days as never]));
const shutDates = (entries: Array<[string, string[]]>): ShutDates => new Map(entries.map(([name, dates]) => [name.toLowerCase(), dates]));
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

describe("holiday dates", () => {
  // Thursday 24 to Sunday 27 December 2026.
  const paris = () => [
    day(1, "2026-12-24", [["Sainte-Chapelle", "landmark"]]),
    day(2, "2026-12-25", [["Louvre Museum", "museum"], ["Café Marly", "restaurant"]]),
    day(3, "2026-12-26", [["Musée d'Orsay", "museum"]]),
    day(4, "2026-12-27", [["Montmartre", "landmark"]]),
  ];

  it("are the plan's dates from Christmas Eve to Epiphany, the first of May and Thanksgiving", () => {
    const span = (from: string, n: number) =>
      Array.from({ length: n }, (_, i) => day(i + 1, new Date(Date.parse(`${from}T00:00:00Z`) + i * 864e5).toISOString().slice(0, 10), []));
    expect(holidayDatesToAsk(span("2026-12-22", 4))).toEqual(["2026-12-24", "2026-12-25"]);
    expect(holidayDatesToAsk(span("2027-01-05", 3))).toEqual(["2027-01-05", "2027-01-06"]);
    expect(holidayDatesToAsk(span("2027-04-29", 4))).toEqual(["2027-05-01"]);
    // Thanksgiving is the fourth Thursday of November: the 26th in 2026, the 25th in 2027.
    expect(holidayDatesToAsk(span("2026-11-18", 10))).toEqual(["2026-11-26"]);
    expect(holidayDatesToAsk(span("2027-11-24", 3))).toEqual(["2027-11-25"]);
    expect(holidayDatesToAsk(seville())).toEqual([]);
    expect(holidayDatesToAsk([{ day_number: 1, activities: [] }])).toEqual([]);
  });

  it("move a sight off the date it is shut, each date keeping its place", () => {
    const days = orderAroundClosings(paris(), new Map(), shutDates([["Louvre Museum", ["2026-12-25"]]]));
    expect(names(days)).toEqual(["Sainte-Chapelle", "Musée d'Orsay", "Louvre Museum+Café Marly", "Montmartre"]);
    expect(days.map((d) => d.date)).toEqual(["2026-12-24", "2026-12-25", "2026-12-26", "2026-12-27"]);
  });

  it("shut a place on that date only, not on the same weekday", () => {
    // Friday 25 December and Friday 1 January.
    const days = [day(1, "2026-12-25", [["Louvre Museum", "museum"]]), day(2, "2027-01-01", [["Louvre Museum", "museum"]])];
    expect(shutStops(days, new Map(), shutDates([["Louvre Museum", ["2026-12-25"]]]))).toBe(1);
    expect(shutStops(days, new Map())).toBe(0);
  });

  it("count with the weekly closing days", () => {
    // Wednesday 25 to Saturday 28 November 2026: the Met is shut on Wednesdays and on Thanksgiving, the statue on Thanksgiving.
    const days = [
      day(1, "2026-11-25", [["Whitney Museum", "museum"]]),
      day(2, "2026-11-26", [["Statue of Liberty", "landmark"]]),
      day(3, "2026-11-27", [["The Met", "museum"]]),
      day(4, "2026-11-28", [["Brooklyn Bridge Park", "landmark"]]),
    ];
    const weekly = closings([["The Met", ["Wednesday"]]]);
    const dated = shutDates([["Statue of Liberty", ["2026-11-26"]], ["The Met", ["2026-11-26"]]]);
    expect(shutStops(days, weekly, dated)).toBe(1);
    const ordered = orderAroundClosings(days, weekly, dated);
    expect(shutStops(ordered, weekly, dated)).toBe(0);
    expect(ordered.map((d) => d.date)).toEqual(days.map((d) => d.date));
    // The weekly closing days alone leave the statue on Thanksgiving.
    expect(shutStops(orderAroundClosings(days, weekly), weekly, dated)).toBe(1);
  });
});

describe("a stop still shut after the reorder", () => {
  type Timed = { name: string; type: string; start_time: string; duration_minutes: number; time_slot?: string };
  const stop = (name: string, type: string, start_time: string, duration_minutes: number): Timed => ({
    name,
    type,
    start_time,
    duration_minutes,
  });
  const timed = (days: Array<{ activities?: Array<{ name?: string; start_time?: string }> }>) =>
    days.map((d) => (d.activities ?? []).map((a) => `${a.start_time} ${a.name}`).join(" | "));
  // Thursday 24 to Saturday 26 December 2026: the Capitoline Museums on Christmas Day, when they are shut.
  const rome = () => [
    { day_number: 1, date: "2026-12-24", activities: [stop("Colosseum", "landmark", "09:00", 180), stop("Trattoria Luzzi", "restaurant", "13:00", 60)] },
    { day_number: 2, date: "2026-12-25", activities: [stop("Capitoline Museums", "museum", "10:00", 120), stop("Pizzeria Remo", "restaurant", "13:00", 60)] },
    { day_number: 3, date: "2026-12-26", activities: [stop("Borghese Gallery", "museum", "10:00", 120)] },
  ];
  const capitolineShut = shutDates([["Capitoline Museums", ["2026-12-25"]]]);

  it("moves to the day with the least planned that it is open on, after the stop ahead of it ends", () => {
    const { days, moved } = moveShutStops(rome(), new Map(), capitolineShut);
    expect(moved).toBe(1);
    expect(timed(days)).toEqual([
      "09:00 Colosseum | 13:00 Trattoria Luzzi",
      "13:00 Pizzeria Remo",
      "10:00 Borghese Gallery | 12:20 Capitoline Museums",
    ]);
    expect((days[2].activities[1] as Timed).time_slot).toBe("afternoon");
    expect(days.map((d) => d.date)).toEqual(["2026-12-24", "2026-12-25", "2026-12-26"]);
    expect(shutStops(days, new Map(), capitolineShut)).toBe(0);
  });

  it("keeps its own time where it is free, moving later stops only as far as they must", () => {
    const days = rome();
    days[2].activities = [stop("Borghese Gallery", "museum", "15:00", 120), stop("Galleria Doria", "museum", "18:00", 60)];
    const moved = moveShutStops(days, new Map(), capitolineShut).days;
    expect(timed(moved)[2]).toBe("10:00 Capitoline Museums | 15:00 Borghese Gallery | 18:00 Galleria Doria");

    days[2].activities = [stop("Borghese Gallery", "museum", "11:00", 120), stop("Galleria Doria", "museum", "17:00", 60)];
    expect(timed(moveShutStops(days, new Map(), capitolineShut).days)[2]).toBe(
      "10:00 Capitoline Museums | 12:20 Borghese Gallery | 17:00 Galleria Doria"
    );
  });

  it("leaves the rest of the day as it was, and counts a stop with no length as an hour and a half", () => {
    const days = rome();
    // Galleria Doria already starts before the gallery ends: not this check's to change.
    days[2].activities = [stop("Borghese Gallery", "museum", "15:00", 120), stop("Galleria Doria", "museum", "16:00", 60)];
    expect(timed(moveShutStops(days, new Map(), capitolineShut).days)[2]).toBe(
      "10:00 Capitoline Museums | 15:00 Borghese Gallery | 16:00 Galleria Doria"
    );
    days[2].activities = [{ name: "Borghese Gallery", type: "museum", start_time: "10:00" } as Timed];
    expect(timed(moveShutStops(days, new Map(), capitolineShut).days)[2]).toBe("10:00 Borghese Gallery | 11:50 Capitoline Museums");
  });

  it("takes the nearest of two days with as much planned", () => {
    // Thursday 24 to Sunday 27 December: the gallery is shut on the 26th; the 24th and the 27th hold as much.
    const days = [
      { day_number: 1, date: "2026-12-24", activities: [stop("Colosseum", "landmark", "09:00", 120)] },
      { day_number: 2, date: "2026-12-25", activities: [stop("Vatican Gardens", "landmark", "09:00", 300)] },
      { day_number: 3, date: "2026-12-26", activities: [stop("Borghese Gallery", "museum", "15:00", 120)] },
      { day_number: 4, date: "2026-12-27", activities: [stop("Pantheon", "landmark", "09:00", 120)] },
    ];
    const moved = moveShutStops(days, new Map(), shutDates([["Borghese Gallery", ["2026-12-26"]]])).days;
    expect(timed(moved)).toEqual(["09:00 Colosseum", "09:00 Vatican Gardens", "", "09:00 Pantheon | 15:00 Borghese Gallery"]);
  });

  it("goes to the next day with room when the lightest one would run past the evening", () => {
    // An evening visit: on the 26th it would start after the gallery ends, past ten at night.
    const days = rome();
    days[1].activities = [stop("Pizzeria Remo", "restaurant", "13:00", 60), stop("Capitoline Museums", "museum", "21:00", 60)];
    days[2].activities = [stop("Borghese Gallery", "museum", "20:30", 120)];
    expect(timed(moveShutStops(days, new Map(), capitolineShut).days)).toEqual([
      "09:00 Colosseum | 13:00 Trattoria Luzzi | 21:00 Capitoline Museums",
      "13:00 Pizzeria Remo",
      "20:30 Borghese Gallery",
    ]);
  });

  it("never moves a dated event to make room", () => {
    const days = rome();
    days[0].activities = [stop("Christmas concert", "event", "10:30", 90)];
    days[2].activities = [stop("Borghese Gallery", "museum", "10:00", 120), stop("Opera", "event", "12:00", 150)];
    const { days: after, moved } = moveShutStops(days, new Map(), capitolineShut);
    expect(moved).toBe(0);
    expect(after).toBe(days);
  });

  it("stays when it is shut on every day of the trip, and moves on a weekly closing too", () => {
    const allShut = shutDates([["Capitoline Museums", ["2026-12-24", "2026-12-25", "2026-12-26"]]]);
    const days = rome();
    expect(moveShutStops(days, new Map(), allShut)).toEqual({ days, moved: 0 });
    // Friday 25 December: shut every Friday.
    expect(moveShutStops(rome(), closings([["Capitoline Museums", ["Friday"]]]), new Map()).moved).toBe(1);
  });

  it("is reported by the plan check, with nothing left shut", async () => {
    // Every day has a sight shut on Christmas Day, so no order of the days avoids one.
    const plan = { days: rome() };
    const allOn25 = shutDates([
      ["Capitoline Museums", ["2026-12-25"]],
      ["Colosseum", ["2026-12-25"]],
      ["Borghese Gallery", ["2026-12-25"]],
    ]);
    const ask = vi.fn(async () => ({ closings: new Map(), shutDates: allOn25, costUsd: 0 }));
    const result = await keepOffClosingDays(plan, "Rome", ask);
    expect(result).toMatchObject({ shutBefore: 1, shutAfter: 0, stopsMoved: 1 });
    expect(timed(result.itinerary.days)[1]).toBe("13:00 Pizzeria Remo");
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
    expect(generateContent.mock.calls[0][0]).not.toContain("shutOn");
    expect(JSON.stringify(modelConfig?.generationConfig?.responseSchema)).not.toContain("shutOn");
  });

  it("asks about the holiday dates, by date and weekday, and keeps only the dates it asked about", async () => {
    vi.stubEnv("GOOGLE_AI_API_KEY", "test-key");
    answer = async () => ({
      response: {
        text: () =>
          JSON.stringify({
            places: [
              { n: 1, closed: ["Tuesday"], shutOn: ["2026-12-25", "2026-12-31"] },
              { n: 2, closed: [], shutOn: [] },
              { n: 3, closed: [], shutOn: ["2026-12-26"] },
            ],
          }),
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 40 },
      },
    });
    const dates = ["2026-12-25", "2026-12-26"];
    const found = await askClosingDays("Paris", ["Louvre Museum", "Eiffel Tower", "Musée d'Orsay"], dates);
    expect([...found.closings]).toEqual([["louvre museum", ["Tuesday"]]]);
    expect([...found.shutDates]).toEqual([
      ["louvre museum", ["2026-12-25"]],
      ["musée d'orsay", ["2026-12-26"]],
    ]);
    expect(generateContent.mock.calls[0][0]).toContain("2026-12-25 (Friday), 2026-12-26 (Saturday)");
    const schema = JSON.stringify(modelConfig?.generationConfig?.responseSchema);
    expect(schema).toContain('"shutOn"');
    expect(schema).toContain('"enum":["2026-12-25","2026-12-26"]');
  });

  it("is not asked without a key, and a failed one changes nothing", async () => {
    vi.stubEnv("GOOGLE_AI_API_KEY", "");
    expect((await askClosingDays("Seville", ["Museo de Bellas Artes"])).closings.size).toBe(0);
    expect(generateContent).not.toHaveBeenCalled();

    vi.stubEnv("GOOGLE_AI_API_KEY", "test-key");
    answer = async () => {
      throw new Error("503");
    };
    expect(await askClosingDays("Seville", ["Museo de Bellas Artes"], ["2026-12-25"])).toEqual({
      closings: new Map(),
      shutDates: new Map(),
      costUsd: 0,
    });
  });
});

describe("a plan kept off its closing days", () => {
  it("comes back reordered, with what was asked and found", async () => {
    const plan = { destination: { name: "Seville" }, days: seville() };
    const ask = vi.fn(async () => ({
      closings: closings([["Museo de Bellas Artes", ["Monday"]]]),
      shutDates: new Map(),
      costUsd: 0.0004,
    }));
    const result = await keepOffClosingDays(plan, "Seville", ask);
    expect(ask).toHaveBeenCalledWith("Seville", ["Real Alcázar", "Plaza de España", "Museo de Bellas Artes"], []);
    expect(names(result.itinerary.days)[1]).toBe("Museo de Bellas Artes");
    expect(result).toMatchObject({ costUsd: 0.0004, asked: 3, shutBefore: 1, shutAfter: 0 });
    expect(result.itinerary.destination).toBe(plan.destination);
  });

  it("is the same plan when nothing is shut", async () => {
    const plan = { days: seville() };
    const result = await keepOffClosingDays(plan, "Seville", async () => ({ closings: new Map(), shutDates: new Map(), costUsd: 0 }));
    expect(result.itinerary).toBe(plan);
  });

  it("asks about its holiday dates and keeps its places off them", async () => {
    // Thursday 24 to Sunday 27 December 2026, the Louvre on Christmas Day.
    const plan = {
      days: [
        day(1, "2026-12-24", [["Sainte-Chapelle", "landmark"]]),
        day(2, "2026-12-25", [["Louvre Museum", "museum"]]),
        day(3, "2026-12-26", [["Musée d'Orsay", "museum"]]),
        day(4, "2026-12-27", [["Montmartre", "landmark"]]),
      ],
    };
    const ask = vi.fn(async () => ({ closings: new Map(), shutDates: shutDates([["Louvre Museum", ["2026-12-25"]]]), costUsd: 0 }));
    const result = await keepOffClosingDays(plan, "Paris", ask);
    expect(ask).toHaveBeenCalledWith(
      "Paris",
      ["Sainte-Chapelle", "Louvre Museum", "Musée d'Orsay", "Montmartre"],
      ["2026-12-24", "2026-12-25", "2026-12-26", "2026-12-27"]
    );
    expect(names(result.itinerary.days)[1]).toBe("Musée d'Orsay");
    expect(result).toMatchObject({ shutBefore: 1, shutAfter: 0 });
  });

  it("hands the days it moved to be re-worded, with the dates they were written for", async () => {
    const plan = {
      days: [
        day(1, "2026-12-24", [["Sainte-Chapelle", "landmark"]]),
        day(2, "2026-12-25", [["Louvre Museum", "museum"]]),
        day(3, "2026-12-26", [["Musée d'Orsay", "museum"]]),
        day(4, "2026-12-27", [["Montmartre", "landmark"]]),
      ],
    };
    const ask = vi.fn(async () => ({ closings: new Map(), shutDates: shutDates([["Louvre Museum", ["2026-12-25"]]]), costUsd: 0.0004 }));
    const reword = vi.fn(async <T extends WordDay>(days: T[], _moves: Move[], _destination: string) => ({
      days: days.map((d) => ({ ...d, theme: `${d.theme} again` }) as T),
      costUsd: 0.0002,
      reworded: 1,
    }));
    // A mock of a generic function is not assignable to it as typed: the cast is for the type checker only.
    const result = await keepOffClosingDays(plan, "Paris", ask, reword as unknown as NonNullable<Parameters<typeof keepOffClosingDays>[3]>);
    expect(reword).toHaveBeenCalledTimes(1);
    expect(reword.mock.calls[0][1]).toEqual([
      { slot: 1, from: "2026-12-26" },
      { slot: 2, from: "2026-12-25" },
    ]);
    expect(reword.mock.calls[0][2]).toBe("Paris");
    expect(names(reword.mock.calls[0][0] as typeof plan.days)).toEqual(["Sainte-Chapelle", "Musée d'Orsay", "Louvre Museum", "Montmartre"]);
    expect(result.itinerary.days.map((d) => d.theme)).toEqual(["theme 1 again", "theme 3 again", "theme 2 again", "theme 4 again"]);
    expect(result.costUsd).toBeCloseTo(0.0006, 10);
    expect(result).toMatchObject({ reworded: 1, shutBefore: 1, shutAfter: 0 });
  });

  it("asks for no re-wording when no day moves", async () => {
    const reword = vi.fn();
    const plan = { days: seville() };
    const result = await keepOffClosingDays(plan, "Seville", async () => ({ closings: new Map(), shutDates: new Map(), costUsd: 0 }), reword);
    expect(reword).not.toHaveBeenCalled();
    expect(result.itinerary).toBe(plan);
    expect(result.reworded).toBe(0);
  });
});
