import { beforeEach, describe, expect, it, vi } from "vitest";

// The model, as the dinner question meets it: each call takes the next answer in line.
let answers: Array<() => Promise<{ response: { text: () => string; usageMetadata?: object } }>> = [];
const generateContent = vi.fn((_question: string) => (answers.shift() ?? (() => Promise.reject(new Error("no answer"))))());
vi.mock("@/lib/ai/gemini-call", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/gemini-call")>()),
  genAI: { getGenerativeModel: () => ({ generateContent }) },
}));

import { askForDinners, daysWithoutDinner, dinnerQuestion, placesToEat, withDinners, type DinnerAnswer } from "@/lib/ai/dinners";

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
    expect(daysWithoutDinner(plan(), "Kyoto")).toEqual([{ after: "Gion", at: at(35.0037, 135.7788), date: "2027-04-06", city: "Kyoto" }]);
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

  it("is left out when it would start after 21:00, is far from that place, or is a place the plan holds", () => {
    const late = plan();
    late[1].activities[2] = { ...late[1].activities[2], start_time: "19:00", duration_minutes: 120 };
    expect(withDinners(late, wanted, { dinners: [gionDinner] }).added).toBe(0);
    const far: DinnerAnswer = { dinners: [{ ...gionDinner, coordinates: { lat: 34.69, lng: 135.5 } }] };
    expect(withDinners(plan(), wanted, far).added).toBe(0);
    const held: DinnerAnswer = { dinners: [{ ...gionDinner, name: "Fushimi Inari" }] };
    expect(withDinners(plan(), wanted, held).added).toBe(0);
  });

  it("is left out when it isn't a real place, answers no day, or the day has dinner by now", () => {
    expect(withDinners(plan(), wanted, { dinners: [{ ...gionDinner, coordinates: { lat: 0, lng: 0 } }] }).added).toBe(0);
    expect(withDinners(plan(), wanted, { dinners: [{ ...gionDinner, n: 2 }] }).added).toBe(0);
    expect(withDinners(plan(), wanted, { dinners: [{ ...gionDinner, name: "" }] }).added).toBe(0);
    const fed = plan();
    fed[1].activities.push(stop("19:00", "Pontocho dinner", "restaurant"));
    expect(withDinners(fed, wanted, { dinners: [gionDinner] }).added).toBe(0);
    expect(withDinners(plan(), wanted, {}).days).toEqual(plan());
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
    expect(q).toContain("1. Kyoto, 2027-04-06: the day ends at Gion (35.00370, 135.77880)");
    expect(q).toContain("in English.");
  });

  it("says nothing of them when the plan has none", () => {
    expect(dinnerQuestion(wanted, { language: "en", taken: [] })).not.toContain("None the plan already has");
    expect(dinnerQuestion(wanted, { language: "en" })).not.toContain("None the plan already has");
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
