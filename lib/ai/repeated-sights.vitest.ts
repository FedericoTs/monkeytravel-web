import { describe, expect, it } from "vitest";
import { repeatedSights, samePlace, sightQuestion, withSightReplacements, type SightRepeat } from "./repeated-sights";
import { nameTokens } from "@/lib/ai/assistant/saved-activities";

/** A long plan visits a sight once: a later day's visit to a place it already has gets another place of its kind. */

const stop = (start_time: string, name: string, type = "museum", lat = 22.3, lng = 114.17, duration_minutes = 120) => ({
  start_time,
  name,
  type,
  duration_minutes,
  coordinates: { lat, lng },
  location: "Central",
  description: "",
});
const day = (day_number: number, activities: ReturnType<typeof stop>[]) => ({
  day_number,
  date: `2026-12-0${day_number}`,
  activities,
});
const named = (...names: string[]) => (s: { name?: string }) => names.includes(s.name ?? "");

describe("samePlace", () => {
  const same = (a: string, b: string) => samePlace(nameTokens(a), nameTokens(b));
  it("is the same name, or the shorter one's words all in the longer when it has two or more", () => {
    expect(same("Man Mo Temple", "Man Mo Temple")).toBe(true);
    expect(same("Peak Tram", "Victoria Peak Tram & Peak Tower")).toBe(true);
    expect(same("Victoria Peak Tram & Peak Tower", "Peak Tram")).toBe(true);
    expect(same("Hong Kong Science Museum", "Hong Kong Museum of History")).toBe(false);
    // One word has to be the whole of the other.
    expect(same("Beach", "Bondi Beach")).toBe(false);
    expect(same("Louvre", "Louvre")).toBe(true);
    // Nothing to tell it by: never the same.
    expect(same("Free time", "Free time")).toBe(false);
  });
});

describe("repeatedSights", () => {
  it("finds a sight a later day visits again, and the stop before it to look near, a ride not counted", () => {
    const days = [
      day(1, [stop("09:00", "Hong Kong Museum of History"), stop("12:30", "Tim Ho Wan", "restaurant", 22.31, 114.17, 90)]),
      day(2, [
        stop("09:00", "Lan Fong Yuen", "cafe", 22.28, 114.15, 60),
        stop("09:40", "MTR to Tsim Sha Tsui", "transport", 22.29, 114.16, 15),
        stop("10:00", "Hong Kong Museum of History"),
      ]),
    ];
    expect(repeatedSights(days, "Hong Kong")).toEqual<SightRepeat[]>([
      {
        name: "Hong Kong Museum of History",
        date: "2026-12-02",
        start_time: "10:00",
        type: "museum",
        near: "Lan Fong Yuen",
        at: { lat: 22.28, lng: 114.15 },
        city: "Hong Kong",
      },
    ]);
  });

  it("finds one named a little differently, and looks near the repeat itself when nothing comes before it", () => {
    const days = [day(1, [stop("14:30", "Peak Tram", "attraction")]), day(2, [stop("09:45", "Victoria Peak Tram & Peak Tower", "landmark", 22.27, 114.15)])];
    expect(repeatedSights(days, "Hong Kong")).toEqual([
      expect.objectContaining({ name: "Victoria Peak Tram & Peak Tower", type: "landmark", near: "Victoria Peak Tram & Peak Tower", at: { lat: 22.27, lng: 114.15 } }),
    ]);
  });

  it("leaves meals, drinks, rides and stays alone, the same day twice, and a different sight", () => {
    const days = [
      day(1, [
        stop("12:30", "Tim Ho Wan", "restaurant"),
        stop("17:00", "Ozone", "bar"),
        stop("08:00", "Airport Express", "transport"),
        stop("20:00", "Hotel ICON", "accommodation"),
        stop("10:00", "Star Ferry", "attraction"),
        stop("16:00", "Star Ferry", "attraction"),
        stop("14:00", "Beach", "park"),
      ]),
      day(2, [
        stop("12:30", "Tim Ho Wan", "restaurant"),
        stop("17:00", "Ozone", "bar"),
        stop("08:00", "Airport Express", "transport"),
        stop("20:00", "Hotel ICON", "accommodation"),
        stop("14:00", "Repulse Bay Beach", "park"),
        stop("10:00", "Hong Kong Science Museum"),
      ]),
    ];
    expect(repeatedSights(days, "Hong Kong")).toEqual([]);
  });

  it("leaves a dated event at a place the plan visits on another day: New Year's Eve at the tower", () => {
    const days = [day(1, [stop("10:00", "Victoria Peak", "landmark")]), day(2, [stop("23:00", "Victoria Peak", "event")])];
    expect(repeatedSights(days, "Hong Kong")).toEqual([]);
    // The same visit twice is still a repeat.
    expect(repeatedSights([day(1, [stop("10:00", "Victoria Peak", "landmark")]), day(2, [stop("15:00", "Victoria Peak", "landmark")])], "Hong Kong")).toHaveLength(1);
  });

  it("keeps the visit they asked for by name and replaces the other, even when it comes first", () => {
    const days = [day(1, [stop("14:30", "Hong Kong Disneyland", "attraction")]), day(2, [stop("09:00", "Hong Kong Disneyland", "attraction")])];
    expect(repeatedSights(days, "Hong Kong", named("Hong Kong Disneyland")).map((w) => w.date)).toEqual(["2026-12-02"]);
    const later = [day(1, [stop("14:30", "Disneyland Park", "attraction")]), day(2, [stop("09:00", "Hong Kong Disneyland Park", "attraction")])];
    expect(repeatedSights(later, "Hong Kong", named("Hong Kong Disneyland Park")).map((w) => `${w.date} ${w.name}`)).toEqual([
      "2026-12-01 Disneyland Park",
    ]);
  });

  it("names the day's city on a trip through several, and asks about ten at most", () => {
    const routeDays = [
      { ...day(1, [stop("10:00", "Louvre")]), city: "Paris" },
      { ...day(2, [stop("10:00", "Louvre")]), city: "Paris" },
    ];
    expect(repeatedSights(routeDays, "France")[0].city).toBe("Paris");
    const words = ["Amber", "Birch", "Cedar", "Delta", "Ember", "Fable", "Grove", "Haven", "Ivory", "Jasper", "Kestrel", "Lumen"];
    const sights = words.map((w) => stop("10:00", `${w} Gallery`));
    const many = [day(1, sights), day(2, sights.map((s) => ({ ...s })))];
    expect(repeatedSights(many, "Hong Kong")).toHaveLength(10);
  });

  it("can't look for one without the day's date or the visit's time", () => {
    const days = [day(1, [stop("10:00", "Man Mo Temple")]), { day_number: 2, activities: [stop("10:00", "Man Mo Temple")] }];
    expect(repeatedSights(days, "Hong Kong")).toEqual([]);
  });
});

describe("sightQuestion", () => {
  it("asks for another place of each kind near the stop named, at its date and time, none the plan has", () => {
    const wanted: SightRepeat[] = [
      { name: "Man Mo Temple", date: "2026-12-09", start_time: "14:15", type: "landmark", near: "Bubba Gump", at: { lat: 22.27, lng: 114.15 }, city: "Hong Kong" },
    ];
    const q = sightQuestion(wanted, { language: "it", taken: ["Man Mo Temple", "Peak Tram"] });
    expect(q).toContain("1. Hong Kong, 2026-12-09 at 14:15, near Bubba Gump (22.27000, 114.15000), instead of Man Mo Temple (landmark)");
    // The places it has come before the visits, and three are asked for each.
    const has = q.indexOf("It already has these places: Man Mo Temple; Peak Tram.");
    expect(has).toBeGreaterThanOrEqual(0);
    expect(has).toBeLessThan(q.indexOf("1. Hong Kong"));
    expect(q).toContain("name three other real places to visit instead, best first: none of the places it already has");
    expect(q).toContain("in Italian");
  });
});

describe("withSightReplacements", () => {
  const days = [
    day(1, [stop("09:00", "Hong Kong Museum of History"), stop("14:30", "Peak Tram", "attraction")]),
    day(2, [stop("09:00", "Lan Fong Yuen", "cafe", 22.28, 114.15, 60), stop("10:00", "Hong Kong Museum of History")]),
  ];
  const wanted = repeatedSights(days, "Hong Kong");
  const place = (name: string, lat = 22.282, lng = 114.152) => ({ name, description: "Old police station.", location: "Central", coordinates: { lat, lng } });
  const offers = (...places: unknown[]) => ({ replacements: [{ n: 1, places }] });

  it("puts the offered place in the repeat's place, at its time and length, as its kind", () => {
    const { days: out, replaced } = withSightReplacements(days, wanted, offers(place("Tai Kwun")));
    expect(replaced).toBe(1);
    expect(out[1].activities.map((a) => a.name)).toEqual(["Lan Fong Yuen", "Tai Kwun"]);
    expect(out[1].activities[1]).toMatchObject({ start_time: "10:00", duration_minutes: 120, type: "museum" });
    expect(out[0]).toBe(days[0]);
  });

  it("takes the first offer that can go in, of three at most", () => {
    const pick = (...places: unknown[]) => withSightReplacements(days, wanted, offers(...places)).days[1].activities[1].name;
    // The plan has it, then too far: the third goes in.
    expect(pick(place("Peak Tram"), place("Tai Kwun", 22.6, 114.4), place("PMQ"))).toBe("PMQ");
    expect(pick(null, place("PMQ"))).toBe("PMQ");
    // A fourth isn't looked at.
    expect(pick(place("Peak Tram"), place("Peak Tram"), place("Peak Tram"), place("PMQ"))).toBe("Hong Kong Museum of History");
  });

  it("leaves the repeat when no offer can go in, the visit is unnumbered, or the repeat is gone", () => {
    const keep = (answer: unknown, from = days) => withSightReplacements(from, wanted, answer as never).replaced;
    expect(keep(offers(place("Tai Kwun", 22.6, 114.4)))).toBe(0);
    expect(keep(offers(place("Victoria Peak Tram")))).toBe(0);
    expect(keep({ replacements: [{ n: 7, places: [place("Tai Kwun")] }] })).toBe(0);
    expect(keep({ replacements: [{ n: 1, places: "Tai Kwun" }] })).toBe(0);
    expect(keep({})).toBe(0);
    const moved = [days[0], day(2, [days[1].activities[0], { ...days[1].activities[1], start_time: "15:00" }])];
    expect(keep(offers(place("Tai Kwun")), moved)).toBe(0);
  });
});
