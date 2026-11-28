import { describe, expect, it } from "vitest";
import type { OpenHours } from "@/lib/ai/known-closings";
import { insideHours, keepInsideHours, type HoursFor } from "@/lib/ai/visit-hours";

const at = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const hours = (open: string, close: string, lastEntry?: string): OpenHours => ({
  open: at(open),
  close: at(close),
  ...(lastEntry ? { lastEntry: at(lastEntry) } : {}),
});

/** Hours by place name; the place asked for is recorded. */
function listed(byName: Record<string, OpenHours>) {
  const asked: string[] = [];
  const hoursFor: HoursFor = (name, place) => {
    asked.push(place);
    return (name && byName[name]) || null;
  };
  return { hoursFor, asked };
}

type Stop = { name: string; type: string; start_time: string; duration_minutes: number; time_slot?: string; locked?: boolean };
const stop = (start_time: string, name: string, type: string, duration_minutes = 90, extra: Partial<Stop> = {}): Stop => ({
  name,
  type,
  start_time,
  duration_minutes,
  ...extra,
});
const day = (activities: Stop[], extra: { date?: string; city?: string } = {}) => ({ date: "2027-01-28", activities, ...extra });
const names = (d: { activities?: { name?: string }[] }) => (d.activities ?? []).map((s) => s.name);

const GARDEN = hours("09:00", "16:00", "15:30");

describe("a visit that runs past closing", () => {
  it("trades slots with the nearest sight earlier in the day that leaves both inside their hours", () => {
    const { hoursFor } = listed({ "East Gardens": GARDEN });
    const plan = [
      day([
        stop("09:00", "Meiji Jingu", "landmark"),
        stop("10:45", "Harajuku", "attraction"),
        stop("12:30", "Lunch", "restaurant"),
        stop("15:00", "East Gardens", "park"),
        stop("18:00", "Dinner", "restaurant"),
      ]),
    ];
    const out = keepInsideHours(plan, "Tokyo", hoursFor);
    const stops = out.days[0].activities as Stop[];
    expect(names(out.days[0])).toEqual(["Meiji Jingu", "East Gardens", "Lunch", "Harajuku", "Dinner"]);
    expect(stops[1]).toMatchObject({ start_time: "10:45", time_slot: "morning", duration_minutes: 90 });
    expect(stops[3]).toMatchObject({ start_time: "15:00", time_slot: "afternoon", duration_minutes: 90 });
    expect(out).toMatchObject({ checked: 1, outside: 1, moved: 1, shortened: 0, left: [] });
  });

  it("is cut to end at closing when no slot of the day fits it, with an hour and half the visit left", () => {
    const { hoursFor } = listed({ "Shinjuku Gyoen": GARDEN });
    const plan = [
      day([
        stop("09:00", "Meiji Jingu", "landmark", 90),
        stop("10:45", "Shibuya Crossing", "attraction", 60),
        stop("12:30", "Lunch", "restaurant"),
        stop("14:30", "Shinjuku Gyoen", "park", 120),
      ]),
    ];
    const out = keepInsideHours(plan, "Tokyo", hoursFor);
    expect(names(out.days[0])).toEqual(["Meiji Jingu", "Shibuya Crossing", "Lunch", "Shinjuku Gyoen"]);
    expect(out.days[0].activities[3]).toMatchObject({ start_time: "14:30", duration_minutes: 90 });
    expect(out).toMatchObject({ outside: 1, moved: 0, shortened: 1, left: [] });
  });

  it("keeps an hour as the shortest visit worth a cut, and half of the visit planned", () => {
    const { hoursFor } = listed({ Garden: GARDEN });
    const exactlyHalf = keepInsideHours([day([stop("15:00", "Garden", "park", 120)])], "Tokyo", hoursFor);
    expect(exactlyHalf.days[0].activities[0].duration_minutes).toBe(60);
    const underAnHour = keepInsideHours([day([stop("15:15", "Garden", "park", 60)])], "Tokyo", hoursFor);
    expect(underAnHour.days[0].activities[0].duration_minutes).toBe(60);
    expect(underAnHour).toMatchObject({ shortened: 0, left: ["Garden (2027-01-28 15:15)"] });
    const underHalf = keepInsideHours([day([stop("15:00", "Garden", "park", 150)])], "Tokyo", hoursFor);
    expect(underHalf).toMatchObject({ shortened: 0, left: ["Garden (2027-01-28 15:00)"] });
  });

  it("is named in the log when it starts after the last entry and nothing can trade with it", () => {
    const { hoursFor } = listed({ Garden: GARDEN });
    const out = keepInsideHours([day([stop("12:30", "Lunch", "restaurant"), stop("15:40", "Garden", "park", 60)])], "Tokyo", hoursFor);
    expect(out.days[0].activities[1]).toMatchObject({ start_time: "15:40", duration_minutes: 60 });
    expect(out).toMatchObject({ checked: 1, outside: 1, moved: 0, shortened: 0, left: ["Garden (2027-01-28 15:40)"] });
  });

  it("lasts an hour and a half when the plan gives it no length", () => {
    const { hoursFor } = listed({ Garden: GARDEN });
    const out = keepInsideHours([{ date: "2027-01-28", activities: [{ name: "Garden", type: "park", start_time: "15:00" }] }], "Tokyo", hoursFor);
    expect(out.days[0].activities[0]).toMatchObject({ duration_minutes: 60 });
    expect(out).toMatchObject({ outside: 1, shortened: 1 });
  });

  it("is never cut when it starts after the last entry, however long until closing", () => {
    const { hoursFor } = listed({ Castle: hours("09:00", "17:00", "15:30") });
    const out = keepInsideHours([day([stop("15:45", "Castle", "landmark", 90)])], "Edinburgh", hoursFor);
    expect(out.days[0].activities[0]).toMatchObject({ start_time: "15:45", duration_minutes: 90 });
    expect(out).toMatchObject({ shortened: 0, left: ["Castle (2027-01-28 15:45)"] });
  });

  it("is never cut to end at closing when it starts before opening", () => {
    // A ride at nine leaves it no room to wait: it trades with nothing, and isn't cut either.
    const { hoursFor } = listed({ Museum: hours("09:30", "17:00") });
    const out = keepInsideHours([day([stop("08:30", "Museum", "museum", 90), stop("09:00", "Bus to Versailles", "transport", 60)])], "Paris", hoursFor);
    expect(out.days[0].activities[0]).toMatchObject({ start_time: "08:30", duration_minutes: 90 });
    expect(out).toMatchObject({ shortened: 0, left: ["Museum (2027-01-28 08:30)"] });
  });
});

describe("a visit planned before its place opens", () => {
  // Ubud's Sacred Monkey Forest opens at nine: a plan had it first thing at half past eight.
  const FOREST = hours("09:00", "18:00", "17:00");

  it("waits for the opening when the day has room, the rest of the day as it was", () => {
    const { hoursFor } = listed({ "Sacred Monkey Forest Sanctuary": FOREST });
    const out = keepInsideHours(
      [day([stop("08:30", "Sacred Monkey Forest Sanctuary", "nature", 120), stop("11:30", "Warung Babi Guling", "restaurant", 60)])],
      "Bali",
      hoursFor
    );
    expect(out.days[0].activities[0]).toMatchObject({ start_time: "09:00", duration_minutes: 120, time_slot: "morning" });
    expect(out.days[0].activities[1]).toMatchObject({ start_time: "11:30" });
    expect(out).toMatchObject({ checked: 1, outside: 1, moved: 1, shortened: 0, left: [] });
  });

  it("is cut to end a walk before the next stop when its whole visit doesn't fit from the opening", () => {
    const { hoursFor } = listed({ "Sacred Monkey Forest Sanctuary": FOREST });
    const out = keepInsideHours(
      [day([stop("08:30", "Sacred Monkey Forest Sanctuary", "nature", 120), stop("10:20", "Ubud Palace", "landmark", 60)])],
      "Bali",
      hoursFor
    );
    // From nine, a walk before twenty past ten: an hour, and half the visit planned.
    expect(out.days[0].activities[0]).toMatchObject({ start_time: "09:00", duration_minutes: 60 });
    expect(out.left).toEqual([]);
  });

  it("doesn't wait past a stop planned before the opening, or when even a cut visit wouldn't fit", () => {
    const { hoursFor } = listed({ "Sacred Monkey Forest Sanctuary": FOREST });
    const early = keepInsideHours(
      [day([stop("08:30", "Sacred Monkey Forest Sanctuary", "nature", 120), stop("08:45", "Coffee at the gate", "cafe", 30)])],
      "Bali",
      hoursFor
    );
    expect(early.days[0].activities[0]).toMatchObject({ start_time: "08:30" });
    expect(early.left).toEqual(["Sacred Monkey Forest Sanctuary (2027-01-28 08:30)"]);
    // Nor past one planned for the same time: the day already has two things then.
    const same = keepInsideHours(
      [day([stop("08:30", "Sacred Monkey Forest Sanctuary", "nature", 120), stop("08:30", "Coffee at the gate", "cafe", 30)])],
      "Bali",
      hoursFor
    );
    expect(same.days[0].activities[0]).toMatchObject({ start_time: "08:30" });
    // A stop at a quarter to ten leaves 25 minutes from the opening: too short to be worth it.
    const tight = keepInsideHours(
      [day([stop("08:30", "Sacred Monkey Forest Sanctuary", "nature", 120), stop("09:45", "Ubud Palace", "landmark", 60)])],
      "Bali",
      hoursFor
    );
    expect(tight.days[0].activities[0]).toMatchObject({ start_time: "08:30" });
  });
});

describe("a dated event at a place of known hours", () => {
  it("keeps its time: New Year's Eve at a tower that shuts at ten isn't moved into the morning", () => {
    const { hoursFor } = listed({ "Taipei 101": hours("09:00", "22:00", "21:15") });
    const eve = [
      day([stop("10:00", "Longshan Temple", "landmark"), stop("19:00", "Din Tai Fung", "restaurant"), stop("23:00", "Taipei 101", "event")], {
        date: "2026-12-31",
      }),
    ];
    const out = keepInsideHours(eve, "Taipei", hoursFor);
    expect(out.days).toEqual(eve);
    expect(out).toMatchObject({ checked: 0, outside: 0, moved: 0, shortened: 0 });
    // The same place as a visit is still held to its hours.
    const visit = [day([stop("10:00", "Longshan Temple", "landmark"), stop("23:00", "Taipei 101", "landmark")], { date: "2026-12-31" })];
    expect(names(keepInsideHours(visit, "Taipei", hoursFor).days[0])).toEqual(["Taipei 101", "Longshan Temple"]);
  });
});

describe("what a late visit may trade with", () => {
  const LATE = stop("15:00", "Garden", "park", 90);

  it("not a meal, a ride, a booked commitment, a shop or a stop tied to its hour", () => {
    const { hoursFor } = listed({ Garden: GARDEN });
    const plan = [
      day([
        stop("09:00", "Breakfast", "restaurant", 60),
        stop("10:15", "Train to Nikko", "transport", 60),
        stop("11:30", "Wedding", "event", 30, { locked: true }),
        stop("12:10", "Sunrise Point", "attraction", 20),
        stop("12:40", "Mall", "shopping", 30),
        LATE,
      ]),
    ];
    const out = keepInsideHours(plan, "Tokyo", hoursFor);
    expect(names(out.days[0])).toEqual(["Breakfast", "Train to Nikko", "Wedding", "Sunrise Point", "Mall", "Garden"]);
    expect(out.moved).toBe(0);
  });

  it("not a booked sight, or one tied to its hour of the day", () => {
    const { hoursFor } = listed({ Garden: GARDEN });
    for (const partner of [stop("10:00", "Castle tour", "attraction", 90, { locked: true }), stop("10:00", "Sunrise Point", "attraction")]) {
      const out = keepInsideHours([day([partner, stop("12:30", "Lunch", "restaurant"), LATE])], "Tokyo", hoursFor);
      expect(names(out.days[0])).toEqual([partner.name, "Lunch", "Garden"]);
      expect(out.moved).toBe(0);
    }
  });

  it("not a slot outside the visit's own hours, though the day has room there", () => {
    const { hoursFor } = listed({ Museum: hours("09:30", "18:00") });
    const out = keepInsideHours([day([stop("08:00", "Park", "park", 60), stop("12:30", "Lunch", "restaurant"), stop("17:00", "Museum", "museum")])], "Paris", hoursFor);
    expect(names(out.days[0])).toEqual(["Park", "Lunch", "Museum"]);
    expect(out).toMatchObject({ moved: 0, shortened: 1 });
  });

  it("not a sight that would leave its own hours in the late slot", () => {
    const { hoursFor } = listed({ Garden: GARDEN, Museum: hours("09:30", "16:00") });
    const out = keepInsideHours([day([stop("10:00", "Museum", "museum"), stop("12:30", "Lunch", "restaurant"), LATE])], "Tokyo", hoursFor);
    expect(names(out.days[0])).toEqual(["Museum", "Lunch", "Garden"]);
    expect(out.moved).toBe(0);
  });

  it("a sight whose own hours hold in the late slot", () => {
    const { hoursFor } = listed({ Garden: GARDEN, Museum: hours("09:30", "18:00") });
    const out = keepInsideHours([day([stop("10:00", "Museum", "museum"), stop("12:30", "Lunch", "restaurant"), LATE])], "Tokyo", hoursFor);
    expect(names(out.days[0])).toEqual(["Garden", "Lunch", "Museum"]);
    expect(out).toMatchObject({ checked: 2, outside: 1, moved: 1 });
  });

  it("not one whose slot is too short for the visit, or whose own visit would run into the next stop", () => {
    const { hoursFor } = listed({ Garden: GARDEN });
    const tooShort = keepInsideHours(
      [day([stop("10:00", "Temple", "landmark", 60), stop("11:00", "Lunch", "restaurant"), stop("15:00", "Garden", "park", 90)])],
      "Tokyo",
      hoursFor
    );
    expect(tooShort.moved).toBe(0);
    const runsOn = keepInsideHours(
      [day([stop("10:00", "Long walk", "nature", 150), stop("13:00", "Lunch", "restaurant"), stop("15:00", "Garden", "park", 90), stop("16:40", "Tea", "cafe")])],
      "Tokyo",
      hoursFor
    );
    expect(runsOn.moved).toBe(0);
  });

  it("a sight later in the day, for a visit planned before opening", () => {
    const { hoursFor } = listed({ Museum: hours("09:30", "18:00") });
    const out = keepInsideHours([day([stop("08:30", "Museum", "museum", 90), stop("10:15", "Lunch", "restaurant", 60), stop("11:30", "Park", "park", 90)])], "Paris", hoursFor);
    expect(names(out.days[0])).toEqual(["Park", "Lunch", "Museum"]);
    expect(out.days[0].activities[2]).toMatchObject({ start_time: "11:30" });
  });
});

describe("what is looked up", () => {
  it("each day's own city on a trip of several, the trip's destination otherwise", () => {
    const { hoursFor, asked } = listed({});
    keepInsideHours([day([stop("10:00", "Pantheon", "landmark")], { city: "Paris" }), day([stop("10:00", "Pantheon", "landmark")])], "Rome & Paris", hoursFor);
    expect(asked).toEqual(["Paris", "Paris", "Rome & Paris", "Rome & Paris"]);
  });

  it("leaves a day without a date, a stop without a time and a locked commitment as they are", () => {
    const { hoursFor } = listed({ Garden: GARDEN });
    const undated = { activities: [stop("15:00", "Garden", "park", 120)] };
    const plan = [undated, day([stop("", "Garden", "park", 120), stop("15:30", "Garden", "park", 120, { locked: true })])];
    const out = keepInsideHours(plan, "Tokyo", hoursFor);
    expect(out.days[0]).toBe(undated);
    expect(out.days[1]).toBe(plan[1]);
    expect(out).toMatchObject({ checked: 0, outside: 0, moved: 0, shortened: 0, left: [] });
  });

  it("leaves a visit named for its hour as planned: a temple's night opening keeps its evening", () => {
    const { hoursFor } = listed({ "Kiyomizu-dera Night Illumination": hours("06:00", "18:00"), "Temple at sunset": hours("06:00", "17:00") });
    const plan = [
      day([
        stop("10:00", "Museum", "museum"),
        stop("16:30", "Temple at sunset", "landmark", 60),
        stop("18:30", "Kiyomizu-dera Night Illumination", "landmark"),
      ]),
    ];
    const out = keepInsideHours(plan, "Kyoto", hoursFor);
    expect(out.days[0]).toBe(plan[0]);
    expect(out).toMatchObject({ checked: 0, outside: 0, left: [] });
  });

  it("gives back the same day when every visit is inside its hours", () => {
    const { hoursFor } = listed({ Garden: GARDEN });
    const plan = [day([stop("10:00", "Garden", "park", 120)])];
    expect(keepInsideHours(plan, "Tokyo", hoursFor).days[0]).toBe(plan[0]);
  });
});

describe("inside a day's hours", () => {
  it("from opening, up to the last entry, out by closing", () => {
    expect(insideHours(at("09:00"), 60, GARDEN)).toBe(true);
    expect(insideHours(at("08:59"), 60, GARDEN)).toBe(false);
    expect(insideHours(at("15:00"), 60, GARDEN)).toBe(true);
    expect(insideHours(at("15:00"), 61, GARDEN)).toBe(false);
    expect(insideHours(at("15:31"), 20, GARDEN)).toBe(false);
    expect(insideHours(at("15:40"), 20, hours("09:00", "16:00"))).toBe(true);
    expect(insideHours(at("23:00"), 600, null)).toBe(true);
  });
});

describe("a meal named after a sight", () => {
  // Live, "Armando al Pantheon" (a restaurant) matched the Pantheon's hours: a 19:30 dinner read as a visit after closing.
  it("keeps its time: it isn't the sight", () => {
    const { hoursFor } = listed({ "Armando al Pantheon": hours("09:00", "19:00", "18:30") });
    const plan = [day([stop("10:00", "Colosseum", "landmark", 120), stop("19:30", "Armando al Pantheon", "restaurant", 120)])];
    const out = keepInsideHours(plan, "Rome", hoursFor);
    expect(out.days[0]).toBe(plan[0]);
    expect(out).toMatchObject({ checked: 0, outside: 0, moved: 0, left: [] });
  });
});
