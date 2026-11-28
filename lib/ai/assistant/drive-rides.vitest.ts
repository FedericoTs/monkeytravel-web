import { describe, expect, it } from "vitest";
import type { Activity, ItineraryDay } from "@/types";
import { formatDuration } from "@/lib/datetime/duration";
import { askLanguage, asksToDriveTheRoute, driveTheRoute } from "./drive-rides";

/**
 * "We'll travel by car for the whole trip" on a trip through several cities: each ride between them (a train, a
 * bus, a flight) becomes a drive, in code, every time. A ride stays, and the reply says why, when no road makes the
 * hop, when the drive would take more than a long day, or when the traveller fixed it.
 */

const at = (lat: number, lng: number) => ({ lat, lng });
const PARIS = at(48.8566, 2.3522);
const LYON = at(45.764, 4.8357);
const NICE = at(43.7102, 7.262);
const AJACCIO = at(41.9192, 8.7386);
const ROME = at(41.9028, 12.4964);

const stop = (name: string, start_time: string, where: { lat: number; lng: number }, extra: Partial<Activity> = {}) =>
  ({ name, start_time, time_slot: "morning", duration_minutes: 90, type: "attraction", coordinates: where, ...extra }) as unknown as Activity;
const ride = (mode: string, to: string, from: string, extra: Partial<Activity> = {}) =>
  ({
    name: `${mode === "flight" ? "Flight" : mode === "ferry" ? "Ferry" : "Train"} to ${to}`,
    type: "transport",
    transport_mode: mode,
    start_time: "08:30",
    time_slot: "morning",
    duration_minutes: 150,
    location: from,
    ...extra,
  }) as unknown as Activity;
const day = (day_number: number, city: string, activities: Activity[]) =>
  ({ day_number, date: `2027-05-0${day_number}`, city, activities }) as unknown as ItineraryDay;

/** Paris (2 days), Lyon, Nice (2 days), by train. */
const france = [
  day(1, "Paris, France", [stop("Louvre", "10:00", PARIS), stop("Le Marais lunch", "13:00", PARIS, { type: "restaurant" })]),
  day(2, "Paris, France", [stop("Musée d'Orsay", "10:00", PARIS)]),
  day(3, "Lyon, France", [ride("train", "Lyon", "Paris"), stop("Vieux Lyon", "11:30", LYON), stop("Fourvière", "15:30", LYON)]),
  day(4, "Nice, France", [ride("train", "Nice", "Lyon"), stop("Promenade des Anglais", "12:00", NICE)]),
  day(5, "Nice, France", [stop("Castle Hill", "10:00", NICE)]),
];

describe("asksToDriveTheRoute", () => {
  it.each([
    "travel by car for the whole trip",
    "We'll drive instead of taking the trains",
    "can you change the trains to a car?",
    "we have a car",
    "vamos en coche todo el viaje",
    "viaggeremo in macchina",
    "vamos de carro",
  ])("takes %j as the whole route by car", (message) => {
    expect(asksToDriveTheRoute(message, france)).toBe(true);
  });

  it.each([
    ["no car: trains only", "we don't have a car, trains only please"],
    ["no car, said with the car's own words", "we don't have a car for the whole trip"],
    ["a car weighed up", "is it better to drive or take the train?"],
    ["renting a car weighed up", "should we rent a car for the whole trip?"],
    ["a drive as a thing to do", "add a scenic drive"],
    ["one day", "we'll drive on day 3 instead"],
    ["a city of the route named", "we'll drive from Lyon to Nice instead"],
    ["trains wanted beside the car", "il viaggio sarà in auto, considera anche treni dove posso caricare la macchina"],
    ["no car at all", "what time does the Louvre open?"],
    ["more than the car", `travel by car for the whole trip, and ${"add a vegetarian dinner every evening near the hotel ".repeat(3)}`],
  ])("leaves %s to the model", (_, message) => {
    expect(asksToDriveTheRoute(message, france)).toBe(false);
  });
});

describe("askLanguage", () => {
  it.each([
    ["travel by car for the whole trip", "en"],
    ["vamos en coche todo el viaje", "es"],
    ["viaggeremo in macchina", "it"],
    ["vamos de carro a viagem toda", "pt"],
  ] as const)("reads %j as %s from its own words", (message, language) => {
    expect(askLanguage(message, "en")).toBe(language);
  });

  it("falls back to the page's language when the words don't tell", () => {
    expect(askLanguage("ok", "it")).toBe("it");
  });
});

describe("driveTheRoute", () => {
  it("puts a drive in place of each train, fitting its day around the arrival", () => {
    const out = driveTheRoute(france, { currency: "EUR", language: "en" });
    expect(out.edits.map((e) => e.day_number)).toEqual([3, 4]);
    const lyon = out.edits[0];
    const drive = lyon.activities[0];
    expect(drive).toMatchObject({ name: "Drive to Lyon", type: "transport", transport_mode: "ground", start_time: "08:30", booking_required: false });
    expect(lyon.activities.some((a) => a.name === "Train to Lyon")).toBe(false);
    expect(lyon.city).toBe("Lyon, France");
    // Vieux Lyon was during the drive: it moves to after the arrival, 30 minutes after the drive ends.
    const arrives = 8 * 60 + 30 + (drive.duration_minutes ?? 0) + 30;
    const vieux = lyon.activities.find((a) => a.name === "Vieux Lyon")!;
    const [h, m] = vieux.start_time!.split(":").map(Number);
    expect(h * 60 + m).toBeGreaterThanOrEqual(arrives);
    expect(out.edits[1].activities[0].name).toBe("Drive to Nice");
  });

  it("measures each drive by road from the cities' places, in a few hours", () => {
    const out = driveTheRoute(france, { currency: "EUR", language: "en" });
    const [toLyon, toNice] = out.drives;
    expect(toLyon.minutes).toBeGreaterThanOrEqual(4 * 60);
    expect(toLyon.minutes).toBeLessThanOrEqual(7 * 60);
    expect(toNice.minutes).toBeGreaterThanOrEqual(3 * 60);
    expect(toNice.minutes).toBeLessThanOrEqual(6 * 60);
  });

  it("says which rides are now drives, and how long each takes", () => {
    const out = driveTheRoute(france, { currency: "EUR", language: "en" });
    const [toLyon, toNice] = out.drives;
    expect(out.reply).toBe(
      `Here are the rides between your cities as drives: Paris to Lyon, about ${formatDuration(toLyon.minutes)}; Lyon to Nice, about ${formatDuration(toNice.minutes)}. Each leaves at 08:30, and its time is an estimate from the distance.`,
    );
  });

  it("answers in the traveller's language", () => {
    const out = driveTheRoute(france, { currency: "EUR", language: "it" });
    expect(out.edits[0].activities[0].name).toBe("In auto a Lyon");
    expect(out.reply.startsWith("Ecco gli spostamenti tra le tue città in auto: da Paris a Lyon, circa ")).toBe(true);
  });

  it("keeps the ferry to an island, and says no road makes it", () => {
    const corsica = [
      ...france.slice(0, 4),
      day(5, "Ajaccio, France", [ride("ferry", "Ajaccio", "Nice"), stop("Old town", "16:00", AJACCIO)]),
    ];
    const out = driveTheRoute(corsica, { currency: "EUR", language: "en" });
    expect(out.edits.map((e) => e.day_number)).toEqual([3, 4]);
    expect(out.kept).toEqual([{ from: "Nice", to: "Ajaccio", mode: "ferry", why: "no_road" }]);
    expect(out.reply).toContain("The ferry from Nice to Ajaccio stays: I can't plan that one by road.");
  });

  it("keeps a ferry even where no island box tells the sea", () => {
    const sicily = [
      day(1, "Naples", [stop("Spaccanapoli", "10:00", at(40.8518, 14.2681))]),
      day(2, "Palermo", [ride("ferry", "Palermo", "Naples"), stop("Palazzo dei Normanni", "15:00", at(38.1157, 13.3615))]),
    ];
    const out = driveTheRoute(sicily, { currency: "EUR", language: "en" });
    expect(out.edits).toEqual([]);
    expect(out.kept).toEqual([{ from: "Naples", to: "Palermo", mode: "ferry", why: "no_road" }]);
  });

  it("keeps a flight to an island of the road lands", () => {
    const mallorca = [
      day(1, "Barcelona", [stop("Sagrada Família", "10:00", at(41.4036, 2.1744))]),
      day(2, "Palma", [ride("flight", "Palma", "Barcelona"), stop("Palma Cathedral", "15:00", at(39.5675, 2.6483))]),
    ];
    const out = driveTheRoute(mallorca, { currency: "EUR", language: "en" });
    expect(out.edits).toEqual([]);
    expect(out.kept).toEqual([{ from: "Barcelona", to: "Palma", mode: "flight", why: "no_road" }]);
  });

  it("keeps a flight longer than a long day's drive, and says how long the drive would be", () => {
    const rome = [day(1, "Paris", [stop("Louvre", "10:00", PARIS)]), day(2, "Rome", [ride("flight", "Rome", "Paris"), stop("Pantheon", "15:00", ROME)])];
    const out = driveTheRoute(rome, { currency: "EUR", language: "en" });
    expect(out.edits).toEqual([]);
    expect(out.kept).toHaveLength(1);
    expect(out.kept[0]).toMatchObject({ from: "Paris", to: "Rome", mode: "flight", why: "too_long" });
    expect(out.kept[0].driveMinutes!).toBeGreaterThan(12 * 60);
    expect(out.reply).toBe(`The flight from Paris to Rome stays: driving it takes about ${formatDuration(out.kept[0].driveMinutes!)}.`);
  });

  it("keeps a flight where a drive can't be measured: it may be over the sea", () => {
    const islands = [
      day(1, "Manila", [stop("Intramuros", "10:00", at(14.5995, 120.9842))]),
      day(2, "Cebu", [ride("flight", "Cebu", "Manila"), stop("Magellan's Cross", "15:00", at(10.3157, 123.8854))]),
    ];
    const out = driveTheRoute(islands, { currency: "USD", language: "en" });
    expect(out.edits).toEqual([]);
    expect(out.kept).toEqual([{ from: "Manila", to: "Cebu", mode: "flight", why: "no_road" }]);
  });

  it("keeps a ride the traveller fixed, and one whose drive would move a fixed plan of the day", () => {
    const fixedRide = france.map((d) =>
      d.day_number === 3 ? { ...d, activities: [ride("train", "Lyon", "Paris", { locked: true } as Partial<Activity>), ...d.activities.slice(1)] } : d,
    );
    expect(driveTheRoute(fixedRide, { currency: "EUR", language: "en" }).kept).toEqual([{ from: "Paris", to: "Lyon", mode: "train", why: "fixed" }]);
    const fixedLunch = france.map((d) =>
      d.day_number === 3 ? { ...d, activities: [...d.activities, stop("Booked bouchon", "12:00", LYON, { type: "restaurant", locked: true } as Partial<Activity>)] } : d,
    );
    const out = driveTheRoute(fixedLunch, { currency: "EUR", language: "en" });
    expect(out.edits.map((e) => e.day_number)).toEqual([4]);
    expect(out.kept).toEqual([{ from: "Paris", to: "Lyon", mode: "train", why: "fixed" }]);
  });

  it("names what the drive leaves no room for", () => {
    const busy = france.map((d) =>
      d.day_number === 3
        ? { ...d, activities: [d.activities[0], stop("Vieux Lyon", "09:00", LYON, { duration_minutes: 240 }), stop("Fourvière", "13:00", LYON, { duration_minutes: 240 }), stop("Parc de la Tête d'Or", "17:00", LYON, { duration_minutes: 180 })] }
        : d,
    );
    const out = driveTheRoute(busy, { currency: "EUR", language: "en" });
    // Both long visits ran into the drive, and after it the evening is taken: they come off. The park keeps its time.
    expect(out.reply.endsWith("To fit the drive, these come off their day: Vieux Lyon, Fourvière.")).toBe(true);
    expect(out.edits[0].activities.map((a) => a.name)).toEqual(["Drive to Lyon", "Parc de la Tête d'Or"]);
  });

  it("makes no change on a trip through one city", () => {
    const paris = france.slice(0, 2);
    expect(driveTheRoute(paris, { currency: "EUR", language: "en" })).toEqual({ edits: [], drives: [], kept: [], reply: "" });
  });
});
