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
  keepOffClosingDaysByCity,
  moveShutStops,
  orderAroundClosings,
  placesToAsk,
  shutStops,
  stopsStillShut,
  type Closings,
  type StuckStop,
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

/** The model's answer alone, without the checked list (lib/ai/known-closings.ts has its own tests). */
const modelOnly = <A extends { closings: Map<string, unknown>; shutDates: Map<string, string[]> }>(answer: A) =>
  ({ closings: answer.closings, shutDates: answer.shutDates, known: 0 }) as never;

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

  it("are the plan's dates from Christmas Eve to Epiphany, the first of May, Easter Sunday and Thanksgiving", () => {
    const span = (from: string, n: number) =>
      Array.from({ length: n }, (_, i) => day(i + 1, new Date(Date.parse(`${from}T00:00:00Z`) + i * 864e5).toISOString().slice(0, 10), []));
    expect(holidayDatesToAsk(span("2026-12-22", 4))).toEqual(["2026-12-24", "2026-12-25"]);
    expect(holidayDatesToAsk(span("2027-01-05", 3))).toEqual(["2027-01-05", "2027-01-06"]);
    // Easter Sunday moves: the Western one is 28 March 2027, the Orthodox one 2 May 2027, the day after May Day.
    expect(holidayDatesToAsk(span("2027-04-29", 5))).toEqual(["2027-05-01", "2027-05-02"]);
    expect(holidayDatesToAsk(span("2027-03-26", 4))).toEqual(["2027-03-28"]);
    expect(holidayDatesToAsk(span("2026-04-04", 10))).toEqual(["2026-04-05", "2026-04-12"]);
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

  // Both other days are full until the late afternoon: put in at 14:20 or 13:20, the museum would push the sight
  // after it past half past four, when it would be shut.
  const fullDays = () => {
    const days = rome();
    days[0].activities = [stop("Colosseum", "landmark", "09:00", 240), stop("Trattoria Luzzi", "restaurant", "13:30", 60), stop("Roman Forum", "attraction", "15:00", 120)];
    days[2].activities = [stop("Borghese Gallery", "museum", "10:00", 240), stop("Villa Giulia", "museum", "15:00", 120)];
    return days;
  };

  it("trades days with a sight of a full day, rather than push a sight into the evening", () => {
    const full = fullDays();
    (full[1].activities[0] as Timed).time_slot = "morning";
    (full[2].activities[1] as Timed).time_slot = "afternoon";
    const { days, moved } = moveShutStops(full, new Map(), capitolineShut);
    expect(moved).toBe(1);
    // The 26th's last sight takes the museum's morning on Christmas Day, where it is open.
    expect(timed(days)).toEqual([
      "09:00 Colosseum | 13:30 Trattoria Luzzi | 15:00 Roman Forum",
      "10:00 Villa Giulia | 13:00 Pizzeria Remo",
      "10:00 Borghese Gallery | 14:20 Capitoline Museums",
    ]);
    expect((days[1].activities[0] as Timed).time_slot).toBe("morning");
    expect(shutStops(days, new Map(), capitolineShut)).toBe(0);
    // With the afternoon free on the 26th, it moves there with no trade, as before.
    const free = fullDays();
    free[2].activities = [stop("Borghese Gallery", "museum", "10:00", 240)];
    expect(timed(moveShutStops(free, new Map(), capitolineShut).days).slice(1)).toEqual(["13:00 Pizzeria Remo", "10:00 Borghese Gallery | 14:20 Capitoline Museums"]);
  });

  it("trades with the latest sight that is open on its day, never a meal, a fixed plan or a ride", () => {
    // Villa Giulia is shut on Christmas Day too: the gallery before it goes instead.
    const bothShut = shutDates([["Capitoline Museums", ["2026-12-25"]], ["Villa Giulia", ["2026-12-25"]]]);
    expect(timed(moveShutStops(fullDays(), new Map(), bothShut).days).slice(1)).toEqual([
      "10:00 Borghese Gallery | 14:20 Pizzeria Remo",
      "10:00 Capitoline Museums | 15:00 Villa Giulia",
    ]);
    // The latest that makes room, that is: with either afternoon sight gone, the other would still start past half
    // past four. The morning's gallery goes.
    const afternoons = fullDays();
    afternoons[2].activities = [stop("Borghese Gallery", "museum", "10:00", 240), stop("Villa Giulia", "museum", "14:30", 90), stop("MAXXI", "museum", "16:15", 45)];
    expect(timed(moveShutStops(afternoons, new Map(), capitolineShut).days).slice(1)).toEqual([
      "10:00 Borghese Gallery | 14:20 Pizzeria Remo",
      "10:00 Capitoline Museums | 14:30 Villa Giulia | 16:15 MAXXI",
    ]);
    // Days whose only other stops are a booked tour, a day out by train and dinner have nothing to trade.
    const fixed = fullDays();
    fixed[0].activities = [{ ...stop("Vatican tour", "tour", "09:00", 450), locked: true } as Timed];
    fixed[2].activities = [stop("Train to Orvieto and back", "transport", "09:00", 460), stop("Dinner at Roscioli", "restaurant", "19:00", 90)];
    const { days: after, moved } = moveShutStops(fixed, new Map(), capitolineShut);
    expect(moved).toBe(0);
    expect(after).toBe(fixed);
  });

  it("trades a sight of the day at a time of the day: an evening stop and a morning one never change places", () => {
    // Open on the 26th alone, where the afternoon would run into the concert.
    const shut = shutDates([["Capitoline Museums", ["2026-12-24", "2026-12-25"]]]);
    const days = rome();
    days[2].activities = [
      stop("Borghese Gallery", "museum", "10:00", 120),
      stop("Villa Giulia", "museum", "13:00", 180),
      stop("Gianicolo at sunset", "attraction", "17:00", 60),
      stop("Christmas concert", "event", "18:30", 90),
    ];
    // Taking the sunset out would make room too: it stays in its evening, and the afternoon's museum goes.
    expect(timed(moveShutStops(days, new Map(), shut).days).slice(1)).toEqual([
      "10:00 Villa Giulia | 13:20 Pizzeria Remo",
      "10:00 Borghese Gallery | 12:20 Capitoline Museums | 17:00 Gianicolo at sunset | 18:30 Christmas concert",
    ]);
    // An evening opening that is shut: the gallery won't take its seven o'clock.
    const evening = rome();
    evening[1].activities = [stop("Pizzeria Remo", "restaurant", "13:00", 60), stop("Capitoline Museums", "museum", "19:00", 40)];
    evening[2].activities = [stop("Borghese Gallery", "museum", "14:00", 300), stop("Christmas concert", "event", "20:00", 90)];
    const { days: after, moved } = moveShutStops(evening, new Map(), shut);
    expect(moved).toBe(0);
    expect(after).toBe(evening);
  });

  it("stays, to be swapped where it is, when no sight of an open day can take its place", () => {
    // Every other sight of the trip is shut on Christmas Day as well.
    const allShut = shutDates(
      ["Capitoline Museums", "Colosseum", "Roman Forum", "Borghese Gallery", "Villa Giulia"].map((name) => [name, ["2026-12-25"]] as [string, string[]])
    );
    const days = fullDays();
    const { days: after, moved } = moveShutStops(days, new Map(), allShut);
    expect(moved).toBe(0);
    expect(after).toBe(days);
    expect(stopsStillShut(after, new Map(), allShut).map((s) => s.name)).toEqual(["Capitoline Museums"]);
    // Or the one sight that could is so long that its new day's afternoon walk would start in the evening.
    const long = rome();
    long[1].activities = [stop("Capitoline Museums", "museum", "10:00", 120), stop("Pizzeria Remo", "restaurant", "13:00", 60), stop("Trastevere walk", "attraction", "14:30", 90)];
    long[2].activities = [stop("Vatican Museums", "museum", "09:00", 440)];
    expect(moveShutStops(long, new Map(), shutDates([["Capitoline Museums", ["2026-12-24", "2026-12-25"]]])).moved).toBe(0);
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
    const result = await keepOffClosingDays(plan, "Rome", ask, undefined, undefined, modelOnly);
    expect(result).toMatchObject({ shutBefore: 1, shutAfter: 0, stopsMoved: 1 });
    expect(timed(result.itinerary.days)[1]).toBe("13:00 Pizzeria Remo");
  });
});

describe("a stop shut on every date it could go to", () => {
  type Timed = { name: string; type: string; start_time: string; duration_minutes: number };
  const stop = (name: string, type: string, start_time: string, duration_minutes: number): Timed => ({ name, type, start_time, duration_minutes });
  // Wednesday 29 December 2027 to Saturday 1 January 2028 in Tokyo.
  const tokyo = () => [
    { day_number: 1, date: "2027-12-29", activities: [stop("Tokyo National Museum", "museum", "09:30", 150), stop("Ueno Seiyoken", "restaurant", "12:30", 90)] },
    { day_number: 2, date: "2027-12-30", activities: [stop("teamLab Planets", "attraction", "10:00", 150)] },
    { day_number: 3, date: "2027-12-31", activities: [stop("Yoyogi Park", "nature", "14:15", 120)] },
    { day_number: 4, date: "2028-01-01", activities: [stop("Meiji Jingu", "landmark", "08:30", 120)] },
  ];
  const newYear = shutDates([["Tokyo National Museum", ["2027-12-29", "2027-12-30", "2027-12-31", "2028-01-01"]]]);
  const ask = async () => ({ closings: new Map(), shutDates: newYear, costUsd: 0.0004 });

  it("is found where it is, with its day, date and time", () => {
    expect(stopsStillShut(tokyo(), new Map(), newYear)).toEqual([
      { day: 1, date: "2027-12-29", name: "Tokyo National Museum", start_time: "09:30", duration_minutes: 150 },
    ]);
    expect(stopsStillShut(tokyo(), closings([["Meiji Jingu", ["Saturday"]]]), new Map())).toEqual([
      { day: 4, date: "2028-01-01", name: "Meiji Jingu", start_time: "08:30", duration_minutes: 120 },
    ]);
    expect(stopsStillShut(tokyo(), new Map(), new Map())).toEqual([]);
  });

  it("is handed to the swap, which the plan check then reports", async () => {
    const swap = vi.fn(async (days: WordDay[], _stuck: StuckStop[]) => ({
      days: days.map((d, i) => (i === 0 ? { ...d, activities: [{ name: "Mori Art Museum", type: "museum" }, ...(d.activities ?? []).slice(1)] } : d)),
      swapped: 1,
      costUsd: 0.0003,
    }));
    const result = await keepOffClosingDays({ days: tokyo() }, "Tokyo", ask, undefined, swap);
    expect(swap).toHaveBeenCalledTimes(1);
    expect(swap.mock.calls[0][1]).toEqual([{ day: 1, date: "2027-12-29", name: "Tokyo National Museum", start_time: "09:30", duration_minutes: 150 }]);
    expect(names(result.itinerary.days as Array<{ activities: Array<{ name: string }> }>)[0]).toBe("Mori Art Museum+Ueno Seiyoken");
    expect(result).toMatchObject({ shutBefore: 1, shutAfter: 0, stopsMoved: 0, swapped: 1 });
    expect(result.costUsd).toBeCloseTo(0.0007, 10);
  });

  it("is not swapped without a swap, or when nothing is stuck", async () => {
    const without = await keepOffClosingDays({ days: tokyo() }, "Tokyo", ask);
    expect(without).toMatchObject({ shutAfter: 1, swapped: 0 });
    // The one left shut, by name and date, for the log.
    expect(without.leftShut).toEqual(["Tokyo National Museum (2027-12-29)"]);
    const swap = vi.fn();
    const open = await keepOffClosingDays({ days: tokyo() }, "Tokyo", async () => ({ closings: new Map(), shutDates: new Map(), costUsd: 0 }), undefined, swap);
    expect(swap).not.toHaveBeenCalled();
    expect(open.swapped).toBe(0);
    expect(open.leftShut).toEqual([]);
  });
});

describe("the places asked about", () => {
  it("are the plan's sights and markets, each once, not its meals", () => {
    const days = seville();
    days[2].activities.push({ name: "Real Alcázar ", type: "attraction" }, { name: "El Rinconcillo", type: "restaurant" });
    expect(placesToAsk(days)).toEqual(["Real Alcázar", "Plaza de España", "Museo de Bellas Artes"]);
  });

  // A botanical garden shut on Christmas Day and a department store shut on New Year's Day stayed on those days:
  // gardens and shops were never asked about. A beach, a hike or a viewpoint walk is open whatever the date.
  it("are its parks, gardens and shops too, not its nature stops", () => {
    const days = [
      {
        day_number: 1,
        date: "2026-12-25",
        activities: [
          { name: "Royal Botanic Garden", type: "park" },
          { name: "Grand Department Store", type: "shopping" },
          { name: "Cliff Path Walk", type: "nature" },
          { name: "Old Town Beach", type: "beach" },
        ],
      },
    ];
    expect(placesToAsk(days)).toEqual(["Royal Botanic Garden", "Grand Department Store"]);
  });

  // A botanical garden typed as a nature stop stayed on Christmas Day: the name says it has gates and holidays.
  it("are a garden, zoo or aquarium typed as a nature stop, by its name in any language", () => {
    const stops = [
      "Jardín Botánico Municipal",
      "City Zoo",
      "Zoológico del Valle",
      "Harbour Aquarium",
      "Acquario Civico",
      "Schlossgarten",
      "Orto Botanico",
      "Hillside Arboretum",
      "Rose Gardens",
      "Palace Gyoen",
      "Jardins du Musée",
      "Glasshouse Conservatory",
      "Hortus Medicus",
      "Giardino Pubblico",
      "Jardim da Cidade",
      // Open whatever the date, or a garden only inside another word.
      "Cliff Path Walk",
      "Waterfall Trail",
      "Zoom Point Lookout",
      "Gardena Valley Hike",
    ];
    // A café, a station or a hotel named after a garden or a zoo is not one.
    const named = [
      { name: "Garden Terrace Café", type: "cafe" },
      { name: "Zoo Station", type: "transport" },
      { name: "Hotel Jardín", type: "accommodation" },
    ];
    const days = [{ day_number: 1, date: "2026-12-25", activities: [...stops.map((name) => ({ name, type: "nature" })), ...named] }];
    expect(placesToAsk(days)).toEqual(stops.slice(0, 15));
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

  it("asks about the holiday dates, by date, weekday and holiday, and keeps only the dates it asked about", async () => {
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
    expect(generateContent.mock.calls[0][0]).toContain("2026-12-25 (Friday, Christmas Day), 2026-12-26 (Saturday, St Stephen's Day)");
    const schema = JSON.stringify(modelConfig?.generationConfig?.responseSchema);
    expect(schema).toContain('"shutOn"');
    expect(schema).toContain('"enum":["2026-12-25","2026-12-26"]');
  });

  it("names each holiday it asks about, and only the days that are one", async () => {
    vi.stubEnv("GOOGLE_AI_API_KEY", "test-key");
    answer = async () => ({
      response: { text: () => JSON.stringify({ places: [] }), usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 4 } },
    });
    const dates = ["2026-11-26", "2026-12-24", "2026-12-28", "2026-12-31", "2027-01-01", "2027-01-06", "2027-03-28", "2027-05-01", "2027-05-02"];
    await askClosingDays("Athens", ["Acropolis Museum"], dates);
    expect(generateContent.mock.calls[0][0]).toContain(
      [
        "2026-11-26 (Thursday, Thanksgiving Day in the United States)",
        "2026-12-24 (Thursday, Christmas Eve)",
        "2026-12-28 (Monday)",
        "2026-12-31 (Thursday, New Year's Eve)",
        "2027-01-01 (Friday, New Year's Day)",
        "2027-01-06 (Wednesday, Epiphany)",
        "2027-03-28 (Sunday, Easter Sunday)",
        "2027-05-01 (Saturday, May Day)",
        "2027-05-02 (Sunday, Orthodox Easter Sunday)",
      ].join(", ")
    );
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
    const result = await keepOffClosingDays(plan, "Paris", ask, undefined, undefined, modelOnly);
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
    const result = await keepOffClosingDays(plan, "Paris", ask, reword as unknown as NonNullable<Parameters<typeof keepOffClosingDays>[3]>, undefined, modelOnly);
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

// Trips through several cities skipped the step, since their days follow the route, so their sights could stay on
// days they shut. Each city's own days are settled now, the route kept.
describe("a trip through several cities", () => {
  type Stop = { name: string; type: string; start_time?: string; duration_minutes?: number; transport_mode?: string };
  const cityDay = (n: number, date: string, city: string, stops: Stop[]) => ({ day_number: n, date, city, theme: `theme ${n}`, activities: stops });
  const train = (to: string): Stop => ({ name: `Train to ${to}`, type: "transport", start_time: "08:30", duration_minutes: 120, transport_mode: "train" });
  const sight = (name: string, start_time = "11:00"): Stop => ({ name, type: "museum", start_time, duration_minutes: 120 });
  const reword = vi.fn(async <T extends WordDay>(days: T[], _moves: Move[], _destination: string) => ({ days, costUsd: 0.0001, reworded: 0 }));
  const asReword = reword as unknown as NonNullable<Parameters<typeof keepOffClosingDaysByCity>[3]>;
  const closedOn = (entries: Array<[string, string[]]>) => vi.fn(async () => ({ closings: closings(entries), shutDates: new Map(), costUsd: 0.0004 }));
  const cities = (days: Array<{ city?: string }>) => days.map((d) => d.city);

  it("orders each city's days around their closing days, and keeps the route", async () => {
    // Seville on Sunday 29 and Monday 30 November, Granada on Tuesday 1 December.
    const plan = {
      days: [
        cityDay(1, "2026-11-29", "Seville", [sight("Plaza de España")]),
        cityDay(2, "2026-11-30", "Seville", [sight("Museo de Bellas Artes")]),
        cityDay(3, "2026-12-01", "Granada", [train("Granada"), sight("Alhambra", "12:30")]),
      ],
    };
    const ask = closedOn([["Museo de Bellas Artes", ["Monday"]]]);
    const result = await keepOffClosingDaysByCity(plan, "Seville & Granada", ask, asReword, undefined, modelOnly);
    expect(names(result.itinerary.days)).toEqual(["Museo de Bellas Artes", "Plaza de España", "Train to Granada+Alhambra"]);
    expect(cities(result.itinerary.days)).toEqual(["Seville", "Seville", "Granada"]);
    expect(result.itinerary.days.map((d) => d.date)).toEqual(["2026-11-29", "2026-11-30", "2026-12-01"]);
    expect(result).toMatchObject({ asked: 3, shutBefore: 1, shutAfter: 0, leftShut: [] });
    // One question for the whole trip, under its name.
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0]).toEqual(["Seville & Granada", ["Plaza de España", "Museo de Bellas Artes", "Alhambra"], []]);
    // Each city's moved days re-worded in that city.
    expect(reword.mock.calls.at(-1)?.[2]).toBe("Seville");
  });

  it("moves a place only to another day of its own city, and never moves a city's arrival day", async () => {
    // Seville on Sunday 29 November; Granada on Monday 30 (the train) and Tuesday 1 December.
    const plan = {
      days: [
        cityDay(1, "2026-11-29", "Seville", [sight("Real Alcázar")]),
        cityDay(2, "2026-11-30", "Granada", [train("Granada"), sight("Alhambra", "11:00")]),
        cityDay(3, "2026-12-01", "Granada", [sight("Albaicín", "10:00")]),
      ],
    };
    const ask = closedOn([["Alhambra", ["Monday"]], ["Real Alcázar", ["Sunday"]]]);
    const result = await keepOffClosingDaysByCity(plan, "Seville & Granada", ask, asReword, undefined, modelOnly);
    // The arrival day stays first in Granada; the Alhambra goes to Tuesday, its own city's open day.
    expect(names(result.itinerary.days)).toEqual(["Real Alcázar", "Train to Granada", "Albaicín+Alhambra"]);
    // Seville has no other day: its Sunday sight stays, and never goes to Granada.
    expect(result).toMatchObject({ shutBefore: 2, shutAfter: 1, stopsMoved: 1, leftShut: ["Real Alcázar (2026-11-29)"] });
  });

  it("swaps a place shut on every day of its city, asking in that city", async () => {
    const plan = {
      days: [
        cityDay(1, "2026-11-30", "Seville", [sight("Museo de Bellas Artes")]),
        cityDay(2, "2026-12-01", "Granada", [train("Granada"), sight("Alhambra", "12:30")]),
      ],
    };
    const swaps: string[] = [];
    const swapIn = (city: string) =>
      vi.fn(async (days: WordDay[], stuck: StuckStop[]) => {
        swaps.push(`${city}: ${stuck.map((s) => s.name).join(", ")}`);
        return { days, swapped: stuck.length, costUsd: 0.0003 };
      });
    const result = await keepOffClosingDaysByCity(plan, "Seville & Granada", closedOn([["Museo de Bellas Artes", ["Monday"]]]), asReword, swapIn, modelOnly);
    expect(swaps).toEqual(["Seville: Museo de Bellas Artes"]);
    expect(result.swapped).toBe(1);
    expect(result.costUsd).toBeCloseTo(0.0007, 10);
  });

  it("leaves a trip whose places are all open as it was", async () => {
    const plan = { days: [cityDay(1, "2026-11-29", "Seville", [sight("Plaza de España")]), cityDay(2, "2026-11-30", "Granada", [train("Granada")])] };
    const result = await keepOffClosingDaysByCity(plan, "Seville & Granada", closedOn([]), asReword, undefined, modelOnly);
    expect(result.itinerary).toBe(plan);
    expect(result).toMatchObject({ shutBefore: 0, shutAfter: 0, stopsMoved: 0, swapped: 0 });
  });
});
