import { beforeEach, describe, expect, it, vi } from "vitest";

// The model, as the lunch question meets it: each call takes the next answer in line.
let answers: Array<() => Promise<{ response: { text: () => string; usageMetadata?: object } }>> = [];
const generateContent = vi.fn((_question: string) => (answers.shift() ?? (() => Promise.reject(new Error("no answer"))))());
vi.mock("@/lib/ai/gemini-call", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/gemini-call")>()),
  genAI: { getGenerativeModel: () => ({ generateContent }) },
}));

import { askForLunches, daysWithoutLunch, lunchesLeftTogether, lunchQuestion, withLunches, type LunchAnswer } from "@/lib/ai/lunches";

type Stop = {
  name: string;
  type: string;
  start_time: string;
  duration_minutes: number;
  coordinates?: { lat: number; lng: number };
  locked?: boolean;
};
const at = (lat: number, lng: number) => ({ lat, lng });
const stop = (start_time: string, name: string, type: string, duration_minutes = 90, coordinates = at(21.25, -86.74)): Stop => ({
  name,
  type,
  start_time,
  duration_minutes,
  coordinates,
});
const day = (date: string, activities: Stop[], city?: string) => ({ date, activities, ...(city ? { city } : {}) });
const names = (d: { activities?: { name?: string; start_time?: string }[] }) => (d.activities ?? []).map((s) => `${s.start_time} ${s.name}`);

const MUSA = at(21.2063, -86.7181);
// Cancun, three days: the middle one goes from the underwater museum to the turtle farm and the beach with nothing to eat between.
const plan = () => [
  day("2027-03-10", [stop("09:00", "Xcaret", "park", 180), stop("18:30", "La Habichuela", "restaurant")]),
  day("2027-03-11", [
    stop("09:30", "MUSA Underwater Museum", "attraction", 150, MUSA),
    stop("12:30", "Turtle Farm", "nature", 90, at(21.201, -86.7155)),
    stop("14:30", "Playa Delfines", "beach", 120, at(21.2617, -86.7517)),
    stop("18:00", "Lorenzillo's", "restaurant", 90, at(21.2585, -86.7487)),
  ]),
  day("2027-03-12", [stop("10:00", "Chichen Itza", "landmark", 120)]),
];
const fritanga = { n: 1, name: "El Fish Fritanga", description: "Fish tacos by the water.", location: "Hotel Zone", coordinates: { lat: 21.2072, lng: -86.7193 }, cost_per_person_usd: 25 };
const middle = (days: ReturnType<typeof plan>) => days[1].activities;
/** What a lunch step did: how many lunches went in, and why the days asked about that still have none. */
const outcome = ({ added, left }: { added: number; left?: unknown }) => ({ added, left });

describe("the full days without lunch", () => {
  it("are the days between the first and the last with no midday meal, each with the visit lunch follows and its time", () => {
    expect(daysWithoutLunch(plan(), "Cancun")).toEqual([
      { after: "MUSA Underwater Museum", at: MUSA, date: "2027-03-11", city: "Cancun", time: "12:30" },
    ]);
  });

  it("leave out a day with a meal from eleven to three, and name a city's own day by its city", () => {
    const fed = plan();
    middle(fed).push(stop("13:00", "Lolo Lorena's", "restaurant", 60));
    expect(daysWithoutLunch(fed, "Cancun")).toEqual([]);
    const late = plan();
    middle(late)[2] = stop("15:00", "Café Mogagua", "cafe", 45);
    expect(daysWithoutLunch(late, "Cancun")).toEqual([]);
    // Coffee at half past three is no lunch.
    const coffee = plan();
    middle(coffee)[2] = stop("15:30", "Café Mogagua", "cafe", 45);
    expect(daysWithoutLunch(coffee, "Cancun")).toHaveLength(1);
    const cities = [day("2027-03-10", []), day("2027-03-11", middle(plan()), "Isla Mujeres"), day("2027-03-12", [])];
    expect(daysWithoutLunch(cities, "Cancun & Isla Mujeres")[0].city).toBe("Isla Mujeres");
  });

  it("count a breakfast or a morning market as no lunch, and never follow a meal", () => {
    const breakfast = plan();
    middle(breakfast).unshift(stop("08:00", "Café Mogagua", "cafe", 60));
    expect(daysWithoutLunch(breakfast, "Cancun")[0]).toMatchObject({ after: "MUSA Underwater Museum", time: "12:30" });
    const morningMarket = plan();
    middle(morningMarket).unshift(stop("07:30", "Mercado 28", "market", 90));
    expect(daysWithoutLunch(morningMarket, "Cancun")).toHaveLength(1);
    const coffeeOnly = plan();
    coffeeOnly[1].activities = [stop("10:00", "Café Mogagua", "cafe", 45), stop("14:00", "Playa Delfines", "beach", 120)];
    expect(daysWithoutLunch(coffeeOnly, "Cancun")).toEqual([]);
  });

  it("are ten at most in one question", () => {
    const long = [plan()[0], ...Array.from({ length: 11 }, (_, i) => day(`2027-03-${11 + i}`, middle(plan()))), plan()[2]];
    expect(daysWithoutLunch(long, "Cancun")).toHaveLength(10);
  });

  it("leave out a day that eats at a food market by half past two", () => {
    const market = plan();
    middle(market)[1] = stop("12:30", "Mercado 28", "market", 90, at(21.163, -86.83));
    expect(daysWithoutLunch(market, "Cancun")).toEqual([]);
    const tour = plan();
    middle(tour)[1] = stop("12:30", "Downtown Street Food Tour", "tour", 90);
    expect(daysWithoutLunch(tour, "Cancun")).toEqual([]);
    const hawker = plan();
    middle(hawker)[1] = stop("14:30", "Hawker stalls", "attraction", 90);
    expect(daysWithoutLunch(hawker, "Cancun")).toEqual([]);
    const afternoon = plan();
    middle(afternoon)[2] = stop("15:00", "Mercado 23", "market", 60);
    expect(daysWithoutLunch(afternoon, "Cancun")).toHaveLength(1);
  });

  it("leave out a day spent from noon to two on one long visit", () => {
    const trip = plan();
    // Lunch would fit at half past two, after the trip: it was had on it.
    trip[1].activities = [
      stop("09:00", "Isla Contoy day trip", "tour", 300, MUSA),
      stop("16:00", "Playa Delfines", "beach", 90),
      stop("18:30", "Lorenzillo's", "restaurant"),
    ];
    expect(daysWithoutLunch(trip, "Cancun")).toEqual([]);
    // Ending at half past one is not the whole of it.
    trip[1].activities[0] = stop("09:00", "Isla Contoy day trip", "tour", 270, MUSA);
    expect(daysWithoutLunch(trip, "Cancun")[0]).toMatchObject({ after: "Isla Contoy day trip", time: "14:00" });
  });

  it("leave out the first and last days, a day with a ride, and a visit with no pin", () => {
    const ends = plan();
    ends[0].activities = middle(plan());
    ends[2].activities = middle(plan());
    expect(daysWithoutLunch(ends, "Cancun").map((w) => w.date)).toEqual(["2027-03-11"]);
    const ride = plan();
    middle(ride).push(stop("16:30", "Ferry to Cancun", "transport", 30));
    expect(daysWithoutLunch(ride, "Cancun")).toEqual([]);
    const card = plan();
    middle(card).push({ ...stop("16:30", "To Tulum", "attraction", 30), transport_mode: "bus" } as Stop);
    expect(daysWithoutLunch(card, "Cancun")).toEqual([]);
    // A pin far from its day becomes the placeholder of no location (lib/trip/coordinate-fallback.ts).
    const noPin = plan();
    middle(noPin)[0].coordinates = at(48.006, 10.006);
    expect(daysWithoutLunch(noPin, "Cancun")[0]).toMatchObject({ after: "Turtle Farm", time: "14:30" });
    delete middle(noPin)[1].coordinates;
    expect(daysWithoutLunch(noPin, "Cancun")).toEqual([]);
  });

  it("follow the visit whose lunch comes nearest one o'clock, never before noon or after half past two", () => {
    const early = plan();
    early[1].activities = [
      stop("08:30", "Museo Maya", "museum", 120),
      stop("15:00", "Playa Delfines", "beach", 120),
      stop("18:30", "Lorenzillo's", "restaurant"),
    ];
    expect(daysWithoutLunch(early, "Cancun")[0]).toMatchObject({ after: "Museo Maya", time: "12:00" });
    const nearer = plan();
    nearer[1].activities = [
      stop("09:00", "Museo Maya", "museum", 150),
      stop("12:00", "Casa de los Venados", "museum", 60),
      stop("15:00", "Playa Delfines", "beach", 120),
    ];
    // Lunch at 13:30 after the house is nearer one o'clock than at noon after the museum.
    expect(daysWithoutLunch(nearer, "Cancun")[0]).toMatchObject({ after: "Casa de los Venados", time: "13:30" });
    const tooLate = plan();
    tooLate[1].activities = [stop("12:15", "Museo Maya", "museum", 120), stop("19:00", "Lorenzillo's", "restaurant")];
    expect(daysWithoutLunch(tooLate, "Cancun")).toEqual([]);
  });

  it("never follow a visit with another one starting before lunch would", () => {
    const walk = plan();
    walk[1].activities = [stop("08:00", "Coffee walk", "attraction", 60), stop("11:00", "Museo Maya", "museum", 150)];
    // After the walk lunch would wait for noon, and the museum would go after it: lunch follows the museum.
    expect(daysWithoutLunch(walk, "Cancun")[0]).toMatchObject({ after: "Museo Maya", time: "14:00" });
  });

  it("leave out a day with no room for lunch: a sight would be pushed past the afternoon", () => {
    const packed = plan();
    // Lunch at 12:30 moves the ruins to 13:50, and the cenote to 17:10.
    packed[1].activities = [
      stop("09:00", "Xel-Ha", "park", 180),
      stop("12:30", "Tulum ruins", "landmark", 180),
      stop("16:00", "Gran Cenote", "nature", 90),
    ];
    expect(daysWithoutLunch(packed, "Cancun")).toEqual([]);
  });

  it("never move a booked stop: lunch follows it instead", () => {
    const booked = plan();
    booked[1].activities = [
      stop("09:30", "MUSA Underwater Museum", "attraction", 150, MUSA),
      { ...stop("12:30", "Catamaran to Isla Contoy", "tour", 90, at(21.2, -86.72)), locked: true },
      stop("15:00", "Playa Delfines", "beach", 120, at(21.2617, -86.7517)),
    ];
    expect(daysWithoutLunch(booked, "Cancun")[0]).toMatchObject({ after: "Catamaran to Isla Contoy", time: "14:30" });
  });
});

describe("a lunch answered", () => {
  const wanted = daysWithoutLunch(plan(), "Cancun");

  it("goes in twenty minutes after the visit it follows, as a restaurant priced per person, and the day moves on to make room", () => {
    const out = withLunches(plan(), wanted, { lunches: [fritanga] });
    expect(out.added).toBe(1);
    expect(names(out.days[1])).toEqual([
      "09:30 MUSA Underwater Museum",
      "12:30 El Fish Fritanga",
      "13:50 Turtle Farm",
      "15:40 Playa Delfines",
      "18:00 Lorenzillo's",
    ]);
    expect(out.days[1].activities[1]).toMatchObject({
      type: "restaurant",
      duration_minutes: 60,
      location: "Hotel Zone",
      coordinates: { lat: 21.2072, lng: -86.7193 },
      estimated_cost: { amount: 25, currency: "USD" },
    });
    expect(out.days[0]).toEqual(plan()[0]);
    expect(out.days[2]).toEqual(plan()[2]);
  });

  it("follows that visit to the day it moved to, and starts after its visit ends there", () => {
    const moved = plan();
    const musa = middle(moved).shift()!;
    moved[2].activities = [{ ...musa, start_time: "09:00" }, stop("14:00", "Chichen Itza", "landmark", 120)];
    const out = withLunches(moved, wanted, { lunches: [fritanga] });
    expect(names(out.days[2])).toEqual(["09:00 MUSA Underwater Museum", "12:00 El Fish Fritanga", "14:00 Chichen Itza"]);
    expect(names(out.days[1])).toEqual(["12:30 Turtle Farm", "14:30 Playa Delfines", "18:00 Lorenzillo's"]);
  });

  it("is left out when another visit now starts between that one and lunch", () => {
    const moved = plan();
    middle(moved)[0] = { ...middle(moved)[0], start_time: "08:30", duration_minutes: 90 };
    middle(moved).splice(1, 0, stop("10:30", "Ixchel temple", "landmark", 60));
    // The museum now ends at ten, and the temple starts before lunch could.
    expect(outcome(withLunches(moved, wanted, { lunches: [fritanga] }))).toEqual({ added: 0, left: { full: 1 } });
  });

  it("is left out when it is far from that visit, a place the plan holds, or not a real place, and says which", () => {
    const answered = (lunch: Record<string, unknown>) => outcome(withLunches(plan(), wanted, { lunches: [lunch] }));
    expect(answered({ ...fritanga, coordinates: { lat: 21.161, lng: -86.851 } })).toEqual({ added: 0, left: { far: 1 } });
    expect(answered({ ...fritanga, name: "Lorenzillo's" })).toEqual({ added: 0, left: { taken: 1 } });
    expect(answered({ ...fritanga, coordinates: { lat: 0, lng: 0 } })).toEqual({ added: 0, left: { unreal: 1 } });
    expect(answered({ ...fritanga, name: "" })).toEqual({ added: 0, left: { unreal: 1 } });
    // An answer for a day not asked about leaves the one asked about unanswered.
    expect(answered({ ...fritanga, n: 2 })).toEqual({ added: 0, left: { unanswered: 1 } });
    expect(answered(fritanga)).toEqual({ added: 1, left: {} });
  });

  it("is left out when the visit it follows has left the plan or lost its pin, and says so", () => {
    const gone = plan();
    middle(gone).shift();
    expect(outcome(withLunches(gone, wanted, { lunches: [fritanga] }))).toEqual({ added: 0, left: { gone: 1 } });
    const unpinned = plan();
    middle(unpinned)[0] = { ...middle(unpinned)[0], coordinates: undefined };
    expect(outcome(withLunches(unpinned, wanted, { lunches: [fritanga] }))).toEqual({ added: 0, left: { unplaced: 1 } });
  });

  it("counts each day once: a second answer that fits fills it, and of two turned away the first says why", () => {
    const far = { ...fritanga, coordinates: { lat: 21.161, lng: -86.851 } };
    expect(outcome(withLunches(plan(), wanted, { lunches: [far, fritanga] }))).toEqual({ added: 1, left: {} });
    expect(outcome(withLunches(plan(), wanted, { lunches: [far, { ...fritanga, name: "Lorenzillo's" }] }))).toEqual({ added: 0, left: { far: 1 } });
  });

  it("adds up the days left without lunch by why, from two or more counts", () => {
    expect(lunchesLeftTogether({ far: 1 }, { far: 2, late: 1 }, {})).toEqual({ far: 3, late: 1 });
    expect(lunchesLeftTogether()).toEqual({});
  });

  it("is left out when the day eats at midday by now, the visit ends too late, or the day has no room", () => {
    const fed = plan();
    middle(fed).push(stop("13:00", "Lolo Lorena's", "restaurant", 60));
    // A day that eats at midday by now isn't one left without lunch.
    expect(outcome(withLunches(fed, wanted, { lunches: [fritanga] }))).toEqual({ added: 0, left: {} });
    // A day with room left, and a lunch of its own by now.
    const lunched = plan();
    lunched[1].activities = [
      middle(plan())[0],
      stop("12:30", "Lolo Lorena's", "restaurant", 60),
      stop("14:30", "Turtle Farm", "nature", 90),
      stop("18:30", "Lorenzillo's", "restaurant"),
    ];
    expect(outcome(withLunches(lunched, wanted, { lunches: [fritanga] }))).toEqual({ added: 0, left: {} });
    // The museum from noon to half past two: a visit over midday has its lunch there.
    const over = plan();
    middle(over)[0] = { ...middle(over)[0], start_time: "12:00" };
    expect(outcome(withLunches(over, wanted, { lunches: [fritanga] }))).toEqual({ added: 0, left: {} });
    // From a quarter past twelve to a quarter past two: lunch would start after half past two.
    const late = plan();
    middle(late)[0] = { ...middle(late)[0], start_time: "12:15", duration_minutes: 120 };
    expect(outcome(withLunches(late, wanted, { lunches: [fritanga] }))).toEqual({ added: 0, left: { late: 1 } });
    const booked = plan();
    middle(booked)[2].locked = true;
    const out = withLunches(booked, wanted, { lunches: [fritanga] });
    expect(outcome(out)).toEqual({ added: 0, left: { full: 1 } });
    expect(out.days).toEqual(booked);
    expect(withLunches(plan(), wanted, {})).toEqual({ days: plan(), added: 0, left: { unanswered: 1 } });
  });
});

describe("the lunch question", () => {
  const wanted = daysWithoutLunch(plan(), "Cancun");

  it("says each day's visit, its pin and lunch's time, the budget, the diets and the places the plan has", () => {
    const q = lunchQuestion(wanted, { language: "en", budgetTier: "budget", diets: ["vegetarian"], taken: ["Lorenzillo's", "La Habichuela"] });
    expect(q).toContain("1. Cancun, 2027-03-11: lunch at 12:30, after MUSA Underwater Museum (21.20630, -86.71810)");
    expect(q).toContain("inexpensive, where locals eat, with good choices for a vegetarian diet");
    expect(q).toContain("a local place rather than a fast-food chain");
    expect(q).toContain("None the plan already has: Lorenzillo's; La Habichuela.");
    expect(q).toContain("in English.");
  });

  it("says nothing of the plan's places to eat when it has none", () => {
    expect(lunchQuestion(wanted, { language: "es" })).not.toContain("None the plan already has");
    expect(lunchQuestion(wanted, { language: "es" })).toContain("mid-priced");
    expect(lunchQuestion(wanted, { language: "es" })).toContain("in Spanish.");
  });
});

// As with dinners (lib/ai/dinners.ts), the answers vary, so the question is asked twice at once.
describe("the lunch question, asked", () => {
  const says = (lunches: unknown[]) => () =>
    Promise.resolve({ response: { text: () => JSON.stringify({ lunches }), usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 400 } } });
  const fails = () => () => Promise.reject(new Error("timeout"));
  const ask = () => {
    const wanted = daysWithoutLunch(plan(), "Cancun");
    return askForLunches(wanted, { language: "en" }).then(({ answer }) => withLunches(plan(), wanted, answer));
  };

  beforeEach(() => {
    vi.stubEnv("GOOGLE_AI_API_KEY", "test-key");
    generateContent.mockClear();
    answers = [];
  });

  it("is asked twice at once, and a day the first answer couldn't fill takes the second's lunch", async () => {
    answers = [says([{ ...fritanga, name: "Playa Delfines" }]), says([fritanga])];
    const { days, added } = await ask();
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(added).toBe(1);
    expect(names(days[1])).toContain("12:30 El Fish Fritanga");
  });

  it("keeps the first answer's lunch when both can go in", async () => {
    answers = [says([fritanga]), says([{ ...fritanga, name: "Mango Café" }])];
    const { days, added } = await ask();
    expect(added).toBe(1);
    expect(names(days[1]).join(" ")).not.toContain("Mango");
  });

  it("counts what both questions cost, and still fills the day when one fails", async () => {
    const wanted = daysWithoutLunch(plan(), "Cancun");
    answers = [says([fritanga]), fails()];
    const one = (await askForLunches(wanted, { language: "en" })).costUsd;
    answers = [says([fritanga]), says([fritanga])];
    const both = (await askForLunches(wanted, { language: "en" })).costUsd;
    expect(one).toBeGreaterThan(0);
    expect(both).toBeCloseTo(2 * one, 10);
    answers = [fails(), says([fritanga])];
    expect((await ask()).added).toBe(1);
    answers = [fails(), fails()];
    expect((await ask()).added).toBe(0);
  });

  it("isn't asked when no day needs lunch, or there is no key", async () => {
    expect(await askForLunches([], { language: "en" })).toEqual({ answer: {}, costUsd: 0 });
    vi.stubEnv("GOOGLE_AI_API_KEY", "");
    expect(await askForLunches(daysWithoutLunch(plan(), "Cancun"), { language: "en" })).toEqual({ answer: {}, costUsd: 0 });
    expect(generateContent).not.toHaveBeenCalled();
  });
});

describe("a lunch answer the model gets wrong", () => {
  it("is turned away whole when it isn't the shape asked for", () => {
    const wanted = daysWithoutLunch(plan(), "Cancun");
    const odd = { lunches: [{ ...fritanga, n: "1" }, null, { n: 1 }] } as unknown as LunchAnswer;
    expect(withLunches(plan(), wanted, odd).added).toBe(0);
  });
});
