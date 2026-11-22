import { afterEach, describe, expect, it, vi } from "vitest";
import type { Activity } from "@/types";

/**
 * Plans left out must-dos the traveller named: Ichiran ramen and shopping in
 * Harajuku on a Tokyo trip, a palace typed with a letter off. Once a plan is
 * written, the must-dos it holds nowhere get one short question, and each
 * answer goes in only when it fits its day.
 */

let answer: () => Promise<{ response: { text: () => string; usageMetadata?: object } }>;
const generateContent = vi.fn((_question: string) => answer());
vi.mock("@/lib/ai/gemini-call", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/gemini-call")>()),
  genAI: { getGenerativeModel: () => ({ generateContent }) },
}));

import { askedByName, askForMustDos, keepMustDos, missingMustDos, withMustDos, type MustDoAnswer } from "./must-dos";

const at = (start_time: string, name: string, lat = 35.7148, lng = 139.7967, extra: Partial<Activity> = {}) =>
  ({ start_time, duration_minutes: 90, name, type: "attraction", description: "", location: "", coordinates: { lat, lng }, tips: [], booking_required: false, time_slot: "morning", ...extra }) as Activity;
const plan = (names: string[][]) => names.map((list, i) => ({ day_number: i + 1, date: `2026-12-0${i + 3}`, activities: list.map((n) => at("10:00", n)) }));
const tokyo = () => [
  { day_number: 1, date: "2026-12-03", activities: [at("09:00", "Senso-ji"), at("12:00", "Monja Street Restaurant", 35.6655, 139.7837, { duration_minutes: 60 }), at("19:00", "Omoide Yokocho", 35.6932, 139.6995)] },
  { day_number: 2, date: "2026-12-04", activities: [at("09:30", "Shinjuku Gyoen National Garden", 35.6852, 139.71), at("14:00", "Akihabara Electric Town", 35.6984, 139.7731, { duration_minutes: 150 }), at("17:00", "Flight to Osaka", 35.5494, 139.7798, { type: "transport", locked: true })] },
];
const named = (days: Array<{ day_number: number; activities: Activity[] }>) => days.map((d) => `${d.day_number}: ${d.activities.map((a) => `${a.start_time} ${a.name}`).join(" | ")}`);
const ichiran = (extra: Record<string, unknown> = {}) => ({
  must_do: 1,
  day_number: 1,
  replaces: "Monja Street Restaurant",
  activity: { start_time: "12:00", duration_minutes: 60, name: "Ichiran Asakusa", type: "restaurant", description: "Ramen in a booth.", location: "Asakusa", coordinates: { lat: 35.7101, lng: 139.7967 }, ...extra },
});

afterEach(() => {
  vi.unstubAllEnvs();
  generateContent.mockClear();
});

describe("missingMustDos", () => {
  it("finds a must-do no activity holds, and not one held under a fuller name", () => {
    const days = plan([["Plitvice Lakes National Park", "Louisville Slugger Museum & Factory"], ["Triund Trek", "Haeundae Beach"]]);
    expect(missingMustDos(["Plitvice national", "Louisville Slugger Factory", "Triund Trek", "Gangchon Rail Bike", "Haeundae Sky Capsule"], days)).toEqual([
      "Gangchon Rail Bike",
      "Haeundae Sky Capsule",
    ]);
  });

  it("takes a name a letter off for the place", () => {
    const days = plan([["Gyeongbokgung Palace", "Casa Batlló"], ["Acatenango"]]);
    expect(missingMustDos(["gyeongbukgung palace", "casa batilo", "Acatanango"], days)).toEqual([]);
  });

  it("looks for what tells a must-do apart, not for what kind of thing it is", () => {
    const days = plan([["Ichiran Shibuya", "Takeshita Street, Harajuku"], ["Giant Panda Base", "Harbor Ridge Winery"]]);
    expect(missingMustDos(["Ichiran ramen", "Shopping in harajuku", "pandas", "Wineries", "Lake Como"], days)).toEqual(["Lake Como"]);
  });

  it("never finds a wish missing", () => {
    expect(missingMustDos(["eat good food", "take cute pics", "Kids activities", "nature", "museums", "explore"], plan([["Senso-ji"]]))).toEqual([]);
  });

  it("checks each thing of a must-do that lists several", () => {
    expect(missingMustDos(["Senso-ji, Ichiran ramen", "Empire State Building - Statue of Liberty"], plan([["Senso-ji", "Empire State Building"]]))).toEqual([
      "Ichiran ramen",
      "Statue of Liberty",
    ]);
  });
});

describe("askedByName", () => {
  it("knows a stop by a must-do's whole name, a letter off allowed", () => {
    const asked = askedByName(["Tower of London, Victoria and Albert Museum", "Gyeongbukgung palace"]);
    expect(asked({ name: "Tower of London" })).toBe(true);
    expect(asked({ name: "The Tower of London and the Crown Jewels" })).toBe(true);
    expect(asked({ name: "Victoria and Albert Museum" })).toBe(true);
    expect(asked({ name: "Gyeongbokgung Palace" })).toBe(true);
    // On a London trip only "London" tells the Tower apart: the whole name is what was asked for.
    expect(asked({ name: "London Eye" })).toBe(false);
    expect(asked({ name: "Tower Bridge" })).toBe(false);
    expect(asked({ name: "Natural History Museum" })).toBe(false);
    expect(asked({})).toBe(false);
  });

  it("takes no stop for a wish, a kind alone, or no must-dos", () => {
    expect(askedByName(["eat good food", "museums"])({ name: "British Museum" })).toBe(false);
    expect(askedByName(undefined)({ name: "British Museum" })).toBe(false);
    expect(askedByName([])({ name: "British Museum" })).toBe(false);
  });
});

describe("withMustDos", () => {
  it("puts an answer's activity on its day, in time order, in place of the one it replaces", () => {
    const input = tokyo();
    const { days, added } = withMustDos(input, ["Ichiran ramen"], { added: [ichiran()] });
    expect(added).toEqual(["Ichiran ramen"]);
    expect(named(days)[0]).toBe("1: 09:00 Senso-ji | 12:00 Ichiran Asakusa | 19:00 Omoide Yokocho");
    expect(days[0].activities[1]).toMatchObject({ type: "restaurant", time_slot: "afternoon", booking_required: false, tips: [] });
    expect(days[1]).toBe(input[1]);
  });

  it("puts one in at a free time with nothing replaced", () => {
    const { days } = withMustDos(tokyo(), ["Ichiran ramen"], { added: [{ ...ichiran({ start_time: "15:00" }), replaces: "" }] });
    expect(named(days)[0]).toBe("1: 09:00 Senso-ji | 12:00 Monja Street Restaurant | 15:00 Ichiran Asakusa | 19:00 Omoide Yokocho");
  });

  it("turns down an answer that doesn't fit", () => {
    const turnedDown = (entry: MustDoAnswer["added"]) => withMustDos(tokyo(), ["Ichiran ramen"], { added: entry }).added;
    // Another day, no point, no time, a number not on the list.
    expect(turnedDown([{ ...ichiran(), day_number: 9 }])).toEqual([]);
    expect(turnedDown([ichiran({ coordinates: { lat: 0, lng: 0 } })])).toEqual([]);
    expect(turnedDown([ichiran({ start_time: "noon" })])).toEqual([]);
    expect(turnedDown([{ ...ichiran(), must_do: 2 }])).toEqual([]);
    // A place the plan already has.
    expect(turnedDown([ichiran({ name: "Omoide Yokocho" })])).toEqual([]);
    // Over another activity of the day, with nothing taken out to make room.
    expect(turnedDown([{ ...ichiran(), replaces: "" }])).toEqual([]);
    expect(turnedDown([{ ...ichiran(), replaces: "Monja Street" }])).toEqual([]);
  });

  it("never takes out a fixed plan or a transfer to make room", () => {
    const flight = { ...ichiran({ start_time: "17:00" }), day_number: 2, replaces: "Flight to Osaka" };
    expect(withMustDos(tokyo(), ["Ichiran ramen"], { added: [flight] }).added).toEqual([]);
    const train = tokyo().map((d) => ({ ...d, activities: d.activities.map((a) => (a.locked ? { ...a, name: "Train to Osaka", locked: undefined } : a)) }));
    expect(withMustDos(train, ["Ichiran ramen"], { added: [{ ...flight, replaces: "Train to Osaka" }] }).added).toEqual([]);
    const ceremony = tokyo().map((d) => ({ ...d, activities: d.activities.map((a) => (a.locked ? { ...a, name: "Tea ceremony", type: "event" } : a)) }));
    expect(withMustDos(ceremony, ["Ichiran ramen"], { added: [{ ...flight, replaces: "Tea ceremony" }] }).added).toEqual([]);
  });

  it("puts each must-do in once", () => {
    const { days, added } = withMustDos(tokyo(), ["Ichiran ramen"], { added: [ichiran(), { ...ichiran({ name: "Ichiran Shibuya", start_time: "16:00" }), replaces: "" }] });
    expect(added).toEqual(["Ichiran ramen"]);
    expect(named(days)[0]).not.toContain("Shibuya");
  });

  it("on a trip through two cities, keeps a place on its own city's days", () => {
    const korea = [
      { day_number: 1, date: "2026-12-10", city: "Busan", activities: [at("10:00", "Haeundae Beach", 35.1587, 129.1604), at("15:00", "Jagalchi Market", 35.0966, 129.0306)] },
      { day_number: 2, date: "2026-12-11", city: "Seoul", activities: [at("10:00", "N Seoul Tower", 37.5512, 126.9882), at("15:00", "Bukchon Hanok Village", 37.5826, 126.9831)] },
    ];
    const palace = (day: number, lat: number, lng: number) => ({
      must_do: 1,
      day_number: day,
      activity: { start_time: "12:00", duration_minutes: 120, name: "Gyeongbokgung Palace", type: "landmark", description: "", location: "Jongno", coordinates: { lat, lng } },
    });
    expect(withMustDos(korea, ["gyeongbukgung palace"], { added: [palace(1, 37.5796, 126.977)] }).added).toEqual([]);
    expect(named(withMustDos(korea, ["gyeongbukgung palace"], { added: [palace(2, 37.5796, 126.977)] }).days)[1]).toBe(
      "2: 10:00 N Seoul Tower | 12:00 Gyeongbokgung Palace | 15:00 Bukchon Hanok Village"
    );
  });
});

describe("keepMustDos", () => {
  it("asks only about the must-dos the plan holds nowhere, and puts in what fits", async () => {
    const ask = vi.fn(async () => ({ answer: { added: [ichiran()] }, costUsd: 0.001 }));
    const out = await keepMustDos({ days: tokyo() }, "Tokyo", ["Senso-ji", "Ichiran ramen", "eat good food"], "en", ask);
    expect(ask).toHaveBeenCalledWith("Tokyo", tokyo(), ["Ichiran ramen"], "en");
    expect(out).toMatchObject({ costUsd: 0.001, missing: 1, added: 1 });
    expect(named(out.itinerary.days)[0]).toContain("Ichiran Asakusa");
  });

  it("doesn't ask when the plan holds every must-do, or there are none", async () => {
    const ask = vi.fn(async () => ({ answer: {}, costUsd: 0 }));
    const days = { days: tokyo() };
    expect(await keepMustDos(days, "Tokyo", ["Senso-ji"], "en", ask)).toEqual({ itinerary: days, costUsd: 0, missing: 0, added: 0 });
    expect(await keepMustDos(days, "Tokyo", undefined, "en", ask)).toEqual({ itinerary: days, costUsd: 0, missing: 0, added: 0 });
    expect(ask).not.toHaveBeenCalled();
  });

  it("keeps the plan as it was when nothing fits", async () => {
    const days = { days: tokyo() };
    const out = await keepMustDos(days, "Tokyo", ["Ichiran ramen"], "en", async () => ({ answer: { added: [{ ...ichiran(), day_number: 9 }] }, costUsd: 0.001 }));
    expect(out).toEqual({ itinerary: days, costUsd: 0.001, missing: 1, added: 0 });
  });
});

// A day trip the traveller named (a boat to an island, a ski day) was left out: it fits no free hour and
// replacing one stop isn't enough, so the answer said it couldn't fit without disrupting the plan.
describe("withMustDos: a day trip asked for by name", () => {
  const dinner = (time: string, name: string) => at(time, name, 40.84, 14.25, { type: "restaurant", duration_minutes: 90 });
  const town = () => [
    { day_number: 1, date: "2027-06-08", city: "Naples", activities: [at("09:00", "Naples Cathedral", 40.8525, 14.2597), dinner("19:00", "Trattoria del Porto")] },
    {
      day_number: 2,
      date: "2027-06-09",
      city: "Naples",
      activities: [at("09:00", "Archaeological Museum", 40.8535, 14.2508), at("11:00", "Spaccanapoli", 40.8489, 14.2557), dinner("13:00", "Pizzeria al Vico"), at("15:00", "Castel dell'Ovo", 40.8283, 14.2475), dinner("19:00", "Osteria del Mare")],
    },
    { day_number: 3, date: "2027-06-10", city: "Naples", activities: [at("09:00", "Castel Sant'Elmo", 40.8436, 14.2386), dinner("19:00", "Friggitoria al Molo")] },
  ];
  const capri = (day = 2, extra: Record<string, unknown> = {}) => ({
    must_do: 1,
    day_number: day,
    whole_day: true,
    activity: { start_time: "08:30", duration_minutes: 480, name: "Capri boat day", type: "activity", description: "By boat from the harbour.", location: "Molo Beverello", coordinates: { lat: 40.5532, lng: 14.2222 }, ...extra },
  });

  it("takes a whole day of its city, and that day keeps what falls outside the trip's hours", () => {
    const { days, added } = withMustDos(town(), ["Capri"], { added: [capri()] });
    expect(added).toEqual(["Capri"]);
    expect(named(days)[1]).toBe("2: 08:30 Capri boat day | 19:00 Osteria del Mare");
    expect(named(days)[0]).toBe("1: 09:00 Naples Cathedral | 19:00 Trattoria del Porto");
  });

  it("never on the trip's first or last day, a day with a ride, or a city's only day", () => {
    expect(withMustDos(town(), ["Capri"], { added: [capri(1)] }).added).toEqual([]);
    expect(withMustDos(town(), ["Capri"], { added: [capri(3)] }).added).toEqual([]);
    // Even when the first day's hours are free: it's the arrival day.
    const light = town();
    light[0].activities = [dinner("19:00", "Trattoria del Porto")];
    expect(withMustDos(light, ["Capri"], { added: [capri(1)] }).added).toEqual([]);
    const ride = town();
    ride[1].activities.push(at("17:00", "Train to Rome", 40.853, 14.272, { type: "transport", transport_mode: "train" } as Partial<Activity>));
    expect(withMustDos(ride, ["Capri"], { added: [capri()] }).added).toEqual([]);
    const route = town().map((d, i) => ({ ...d, city: ["Rome", "Naples", "Florence"][i] }));
    expect(withMustDos(route, ["Capri"], { added: [capri()] }).added).toEqual([]);
  });

  it("keeps out a day trip whose hours hold a fixed plan", () => {
    const fixed = town();
    fixed[1].activities[1] = { ...fixed[1].activities[1], locked: true };
    expect(withMustDos(fixed, ["Capri"], { added: [capri()] }).added).toEqual([]);
  });

  it("keeps out a short trip marked as a whole day", () => {
    expect(withMustDos(town(), ["Capri"], { added: [capri(2, { duration_minutes: 120 })] }).added).toEqual([]);
  });

  it("gives a long answer its day even when it isn't marked as a day trip", () => {
    const unmarked = { ...capri(), whole_day: undefined, replaces: "Archaeological Museum" };
    expect(named(withMustDos(town(), ["Capri"], { added: [unmarked] }).days)[1]).toBe("2: 08:30 Capri boat day | 19:00 Osteria del Mare");
    // On a day it may not take, a long answer follows the usual rule, and here doesn't fit.
    expect(withMustDos(town(), ["Capri"], { added: [{ ...unmarked, day_number: 1 }] }).added).toEqual([]);
  });
});

describe("askForMustDos", () => {
  it("lets a day trip take a whole day of its city", async () => {
    vi.stubEnv("GOOGLE_AI_API_KEY", "test");
    answer = async () => ({ response: { text: () => JSON.stringify({ added: [], left_out: [] }) } });
    await askForMustDos("Tokyo", tokyo(), ["GALA Yuzawa"], "en");
    const question = generateContent.mock.calls[0][0];
    expect(question).toContain("whole_day");
    expect(question).toContain("not the trip's first or last");
    expect(question).toContain("Never leave one out because a day is full or because it takes a whole day");
  });

  it("asks with the plan's days, times and fixed plans, in the plan's language", async () => {
    vi.stubEnv("GOOGLE_AI_API_KEY", "test");
    answer = async () => ({ response: { text: () => JSON.stringify({ added: [ichiran()], left_out: [] }) } });
    const out = await askForMustDos("Tokyo", tokyo(), ["Ichiran ramen"], "it");
    expect(out.answer.added).toHaveLength(1);
    const question = generateContent.mock.calls[0][0];
    expect(question).toContain("1. Ichiran ramen");
    expect(question).toContain("Day 1 (2026-12-03): 09:00-10:30 Senso-ji; 12:00-13:00 Monja Street Restaurant; 19:00-20:30 Omoide Yokocho");
    expect(question).toContain("17:00-18:30 Flight to Osaka (fixed)");
    expect(question).toContain("in Italian.");
  });

  it("answers nothing when the question fails or there is no key", async () => {
    vi.stubEnv("GOOGLE_AI_API_KEY", "test");
    answer = async () => {
      throw new Error("overloaded");
    };
    expect(await askForMustDos("Tokyo", tokyo(), ["Ichiran ramen"], "en")).toEqual({ answer: {}, costUsd: 0 });
    vi.stubEnv("GOOGLE_AI_API_KEY", "");
    expect(await askForMustDos("Tokyo", tokyo(), ["Ichiran ramen"], "en")).toEqual({ answer: {}, costUsd: 0 });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
});
