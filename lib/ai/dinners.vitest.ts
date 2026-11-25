import { beforeEach, describe, expect, it, vi } from "vitest";

// The model, as the dinner question meets it: each call takes the next answer in line.
let answers: Array<() => Promise<{ response: { text: () => string; usageMetadata?: object } }>> = [];
const generateContent = vi.fn((_question: string) => (answers.shift() ?? (() => Promise.reject(new Error("no answer"))))());
vi.mock("@/lib/ai/gemini-call", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/gemini-call")>()),
  genAI: { getGenerativeModel: () => ({ generateContent }) },
}));

import { askForDinners, daysWithoutDinner, dinnerQuestion, dinnersLeftTogether, placesToEat, withDinners, type DinnerAnswer } from "@/lib/ai/dinners";

type Stop = { name: string; type: string; start_time: string; duration_minutes: number; coordinates?: { lat: number; lng: number } };
const at = (lat: number, lng: number) => ({ lat, lng });
const stop = (start_time: string, name: string, type: string, duration_minutes = 90, coordinates = at(35.0, 135.77)): Stop => ({
  name,
  type,
  start_time,
  duration_minutes,
  coordinates,
});
const day = (date: string, activities: Stop[], city?: string) => ({ date, activities, ...(city ? { city } : {}) });
const names = (d: { activities?: { name?: string; start_time?: string }[] }) => (d.activities ?? []).map((s) => `${s.start_time} ${s.name}`);

// Kyoto, three days: the middle one ends at Gion with no dinner.
const plan = () => [
  day("2027-04-05", [stop("09:00", "Kinkaku-ji", "attraction"), stop("12:30", "Lunch", "restaurant")]),
  day("2027-04-06", [
    stop("09:00", "Fushimi Inari", "attraction"),
    stop("12:30", "Lunch", "restaurant"),
    stop("15:00", "Gion", "attraction", 120, at(35.0037, 135.7788)),
  ]),
  day("2027-04-07", [stop("09:00", "Nijo Castle", "landmark")]),
];
const gionDinner = { n: 1, name: "Gion Karyo", description: "Kaiseki in a machiya.", location: "Gion", coordinates: { lat: 35.0031, lng: 135.7766 }, cost_per_person_usd: 60 };

describe("the full days without dinner", () => {
  it("are the days between the first and the last with no meal from 17:00, each with the place it ends at", () => {
    expect(daysWithoutDinner(plan(), "Kyoto")).toEqual([
      { after: "Gion", at: at(35.0037, 135.7788), date: "2027-04-06", city: "Kyoto", hours: { from: 18 * 60 + 30, by: 21 * 60 } },
    ]);
  });

  it("leave out a day that has dinner, or a bar from the evening, and name a city's own day by its city", () => {
    const withDinner = plan();
    withDinner[1].activities.push(stop("19:00", "Pontocho dinner", "restaurant"));
    expect(daysWithoutDinner(withDinner, "Kyoto")).toEqual([]);
    const withBar = plan();
    withBar[1].activities.push(stop("20:00", "Bar K6", "bar"));
    expect(daysWithoutDinner(withBar, "Kyoto")).toEqual([]);
    const cities = [day("2027-04-05", []), day("2027-04-06", plan()[1].activities, "Kyoto"), day("2027-04-07", [])];
    expect(daysWithoutDinner(cities, "Tokyo & Kyoto")[0].city).toBe("Kyoto");
  });

  it("count a lunch at five as no dinner, and skip a day whose last place has no pin", () => {
    const lateLunch = plan();
    lateLunch[1].activities[1] = stop("16:30", "Late lunch", "restaurant");
    expect(daysWithoutDinner(lateLunch, "Kyoto")).toHaveLength(1);
    const noPin = plan();
    delete noPin[1].activities[2].coordinates;
    expect(daysWithoutDinner(noPin, "Kyoto")[0].after).toBe("Lunch");
  });

  // A pin far from its day becomes the placeholder (lib/trip/coordinate-fallback.ts): no place to have dinner near.
  it("skip a last place whose pin is the placeholder of no location", () => {
    const placeholder = plan();
    placeholder[1].activities[2].coordinates = at(48.006, 10.006);
    expect(daysWithoutDinner(placeholder, "Kyoto")[0].after).toBe("Lunch");
  });
});

describe("a dinner answered", () => {
  const wanted = daysWithoutDinner(plan(), "Kyoto");

  it("goes in half an hour after the place it was chosen near, as a restaurant, priced per person", () => {
    const out = withDinners(plan(), wanted, { dinners: [gionDinner] });
    expect(out.added).toBe(1);
    expect(out.left).toEqual({});
    // Gion ends at 17:00: half an hour later is 17:30, so dinner waits for 18:30.
    expect(names(out.days[1])).toEqual(["09:00 Fushimi Inari", "12:30 Lunch", "15:00 Gion", "18:30 Gion Karyo"]);
    expect(out.days[1].activities[3]).toMatchObject({
      type: "restaurant",
      duration_minutes: 90,
      time_slot: "evening",
      estimated_cost: { amount: 60, currency: "USD" },
    });
  });

  it("follows that place to the day it moved to, and starts after its visit ends there", () => {
    const moved = plan();
    const gion = moved[1].activities.pop()!;
    moved[2].activities.push({ ...gion, start_time: "17:30", duration_minutes: 90 });
    const out = withDinners(moved, wanted, { dinners: [gionDinner] });
    expect(names(out.days[2])).toEqual(["09:00 Nijo Castle", "17:30 Gion", "19:30 Gion Karyo"]);
    expect(names(out.days[1])).toEqual(["09:00 Fushimi Inari", "12:30 Lunch"]);
  });

  it("is left out when it would start after 21:00, is far from that place, or is a place the plan holds, and says which", () => {
    const late = plan();
    late[1].activities[2] = { ...late[1].activities[2], start_time: "19:00", duration_minutes: 120 };
    expect(withDinners(late, wanted, { dinners: [gionDinner] })).toMatchObject({ added: 0, left: { late: 1 } });
    const far: DinnerAnswer = { dinners: [{ ...gionDinner, coordinates: { lat: 34.69, lng: 135.5 } }] };
    expect(withDinners(plan(), wanted, far)).toMatchObject({ added: 0, left: { far: 1 } });
    const held: DinnerAnswer = { dinners: [{ ...gionDinner, name: "Fushimi Inari" }] };
    expect(withDinners(plan(), wanted, held)).toMatchObject({ added: 0, left: { taken: 1 } });
  });

  it("is left out when it isn't a real place, answers no day, or the day has dinner by now, and says which", () => {
    expect(withDinners(plan(), wanted, { dinners: [{ ...gionDinner, coordinates: { lat: 0, lng: 0 } }] })).toMatchObject({ added: 0, left: { unreal: 1 } });
    expect(withDinners(plan(), wanted, { dinners: [{ ...gionDinner, n: 2 }] })).toMatchObject({ added: 0, left: { unanswered: 1 } });
    expect(withDinners(plan(), wanted, { dinners: [{ ...gionDinner, name: "" }] })).toMatchObject({ added: 0, left: { unreal: 1 } });
    // A name of no telling word ("Dinner") is no place either.
    expect(withDinners(plan(), wanted, { dinners: [{ ...gionDinner, name: "Dinner" }] })).toMatchObject({ added: 0, left: { unreal: 1 } });
    const fed = plan();
    fed[1].activities.push(stop("19:00", "Pontocho dinner", "restaurant"));
    expect(withDinners(fed, wanted, { dinners: [gionDinner] })).toEqual({ days: fed, added: 0, left: {} });
    expect(withDinners(plan(), wanted, {})).toEqual({ days: plan(), added: 0, left: { unanswered: 1 } });
  });

  it("is left out when the place it was chosen near has left the plan, and says so", () => {
    const gone = plan();
    gone[1].activities.pop();
    expect(withDinners(gone, wanted, { dinners: [gionDinner] })).toMatchObject({ added: 0, left: { gone: 1 } });
  });

  it("counts a day once: a second answer that fits fills it, two turned away leave it for the first's reason", () => {
    const far = { ...gionDinner, coordinates: { lat: 34.69, lng: 135.5 } };
    expect(withDinners(plan(), wanted, { dinners: [far, gionDinner] })).toMatchObject({ added: 1, left: {} });
    expect(withDinners(plan(), wanted, { dinners: [far, { ...gionDinner, name: "Fushimi Inari" }] })).toMatchObject({ added: 0, left: { far: 1 } });
  });

  it("adds up the days left by why, from two or more counts", () => {
    expect(dinnersLeftTogether({ far: 1 }, { far: 2, late: 1 }, {})).toEqual({ far: 3, late: 1 });
    expect(dinnersLeftTogether()).toEqual({});
  });
});

describe("the plan's own places to eat", () => {
  it("are its restaurants, cafes and bars, once each, in the plan's order", () => {
    const days = [
      day("2027-04-05", [stop("09:00", "Kinkaku-ji", "attraction"), stop("12:30", "Okonomiyaki Kiraku", "restaurant")]),
      day("2027-04-06", [stop("08:30", "% Arabica", "cafe"), stop("12:30", "OKONOMIYAKI KIRAKU", "restaurant"), stop("20:00", "Bar K6", "bar")]),
      day("2027-04-07", [stop("09:00", "Nijo Castle", "landmark"), { ...stop("12:30", "", "restaurant") }]),
    ];
    expect(placesToEat(days)).toEqual(["Okonomiyaki Kiraku", "% Arabica", "Bar K6"]);
  });

  it("are at most forty", () => {
    const many = [day("2027-04-05", Array.from({ length: 45 }, (_, i) => stop("12:30", `Place ${i}`, "restaurant")))];
    expect(placesToEat(many)).toHaveLength(40);
    expect(placesToEat(many)[39]).toBe("Place 39");
  });
});

describe("the dinner question", () => {
  const wanted = daysWithoutDinner(plan(), "Kyoto");

  it("names the plan's own places to eat, so the answer is none of them", () => {
    const q = dinnerQuestion(wanted, { language: "en", taken: ["Okonomiyaki Kiraku", "Bar K6"] });
    expect(q).toContain("None the plan already has: Okonomiyaki Kiraku; Bar K6.");
    expect(q).toContain("1. Kyoto, 2027-04-06, dinner from 18:30: the day ends at Gion (35.00370, 135.77880)");
    expect(q).toContain("in English.");
  });

  it("says nothing of them when the plan has none", () => {
    expect(dinnerQuestion(wanted, { language: "en", taken: [] })).not.toContain("None the plan already has");
    expect(dinnerQuestion(wanted, { language: "en" })).not.toContain("None the plan already has");
  });
});

// Restaurants in Spain open for dinner around 20:00 to 20:30, in Italy around 19:00 to 19:30: a dinner put in at 18:30
// there found the kitchen shut. The hours are those where the day ends (lib/ai/meal-hours.ts).
describe("a dinner where the day ends", () => {
  const madrid = () => [
    day("2027-04-05", [stop("10:00", "Royal Palace", "attraction", 90, at(40.418, -3.7143))]),
    day("2027-04-06", [stop("10:00", "Retiro Park", "park", 90, at(40.4153, -3.6845)), stop("15:00", "Prado Museum", "museum", 120, at(40.4138, -3.6921))]),
    day("2027-04-07", [stop("10:00", "Reina Sofia", "museum", 90, at(40.4086, -3.6943))]),
  ];
  const casaLucio = { n: 1, name: "Casa Lucio", description: "Huevos rotos.", location: "La Latina", coordinates: { lat: 40.4122, lng: -3.7092 } };

  it("starts at the local hour: from 20:30 in Spain, and as late as 22:00", () => {
    const wanted = daysWithoutDinner(madrid(), "Madrid");
    expect(wanted[0].hours).toEqual({ from: 20 * 60 + 30, by: 22 * 60 });
    expect(names(withDinners(madrid(), wanted, { dinners: [casaLucio] }).days[1])).toEqual(["10:00 Retiro Park", "15:00 Prado Museum", "20:30 Casa Lucio"]);
    const late = madrid();
    late[1].activities[1] = { ...late[1].activities[1], start_time: "19:30", duration_minutes: 90 };
    expect(names(withDinners(late, wanted, { dinners: [casaLucio] }).days[1])).toEqual(["10:00 Retiro Park", "19:30 Prado Museum", "21:30 Casa Lucio"]);
  });

  it("starts from 19:30 in Italy", () => {
    const rome = [
      day("2027-04-05", [stop("10:00", "Vatican Museums", "museum", 180, at(41.9065, 12.4536))]),
      day("2027-04-06", [stop("10:00", "Colosseum", "landmark", 150, at(41.8902, 12.4922)), stop("15:00", "Pantheon", "landmark", 120, at(41.8986, 12.4769))]),
      day("2027-04-07", [stop("10:00", "Borghese Gallery", "museum", 120, at(41.9142, 12.4921))]),
    ];
    const wanted = daysWithoutDinner(rome, "Rome");
    const near = { ...casaLucio, name: "Armando al Pantheon", coordinates: { lat: 41.8989, lng: 12.4762 } };
    expect(names(withDinners(rome, wanted, { dinners: [near] }).days[1])).toEqual(["10:00 Colosseum", "15:00 Pantheon", "19:30 Armando al Pantheon"]);
  });

  it("keeps the usual hours for a family that eats early, and asks for a place open then", () => {
    const wanted = daysWithoutDinner(madrid(), "Madrid", true);
    expect(names(withDinners(madrid(), wanted, { dinners: [casaLucio] }).days[1])).toEqual(["10:00 Retiro Park", "15:00 Prado Museum", "18:30 Casa Lucio"]);
    expect(dinnerQuestion(wanted, { language: "en" })).toContain("1. Madrid, 2027-04-06, dinner from 18:30: the day ends at Prado Museum");
    expect(dinnerQuestion(daysWithoutDinner(madrid(), "Madrid"), { language: "en" })).toContain("1. Madrid, 2027-04-06, dinner from 20:30: the day ends at Prado Museum");
  });
});

// The model named a restaurant the plan already has, or one too far away, and those evenings stayed without dinner.
// The question's answers vary, so it is asked twice at once.
describe("the dinner question, asked", () => {
  const says = (dinners: unknown[]) => () =>
    Promise.resolve({ response: { text: () => JSON.stringify({ dinners }), usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 400 } } });
  const fails = () => () => Promise.reject(new Error("timeout"));
  const ask = () => {
    const wanted = daysWithoutDinner(plan(), "Kyoto");
    return askForDinners(wanted, { language: "en" }).then(({ answer }) => withDinners(plan(), wanted, answer));
  };

  beforeEach(() => {
    vi.stubEnv("GOOGLE_AI_API_KEY", "test-key");
    generateContent.mockClear();
    answers = [];
  });

  it("is asked twice at once, and an evening the first answer couldn't fill takes the second's dinner", async () => {
    // The first names a place the plan already has.
    answers = [says([{ ...gionDinner, name: "Nijo Castle" }]), says([gionDinner])];
    const { days, added } = await ask();
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(added).toBe(1);
    expect(names(days[1])).toContain("18:30 Gion Karyo");
    expect(names(days[1])).not.toContain("18:30 Nijo Castle");
  });

  it("keeps the first answer's dinner when both can go in", async () => {
    answers = [says([gionDinner]), says([{ ...gionDinner, name: "Kikunoi Honten" }])];
    const { days, added } = await ask();
    expect(added).toBe(1);
    expect(names(days[1])).toContain("18:30 Gion Karyo");
    expect(names(days[1]).join(" ")).not.toContain("Kikunoi");
  });

  it("counts what both questions cost", async () => {
    const wanted = daysWithoutDinner(plan(), "Kyoto");
    answers = [says([gionDinner]), fails()];
    const one = (await askForDinners(wanted, { language: "en" })).costUsd;
    answers = [says([gionDinner]), says([gionDinner])];
    const both = (await askForDinners(wanted, { language: "en" })).costUsd;
    expect(one).toBeGreaterThan(0);
    expect(both).toBeCloseTo(2 * one, 10);
  });

  it("still fills the evening when one of the two questions fails", async () => {
    answers = [fails(), says([gionDinner])];
    expect((await ask()).added).toBe(1);
    answers = [says([gionDinner]), fails()];
    expect((await ask()).added).toBe(1);
    answers = [fails(), fails()];
    expect((await ask()).added).toBe(0);
  });
});
