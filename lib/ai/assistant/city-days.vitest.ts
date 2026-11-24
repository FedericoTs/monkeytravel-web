/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import type { Activity, ItineraryDay } from "@/types";
import { keepDayCities, placesAway, withoutPlacesAway } from "./city-days";
import type { DayEdit } from "./edit-validation";

/**
 * Asked to "cluster the itinerary by areas" on a trip through Busan and Seoul,
 * the assistant left Busan's sights on Seoul's last day, and some on a Busan day
 * too. Each day is in its city, and so are its places.
 */

const place = (name: string, lat?: number, lng?: number, type = "attraction") =>
  ({ name, type, time_slot: "morning", start_time: "10:00", duration_minutes: 90, ...(lat !== undefined ? { coordinates: { lat, lng } } : {}) }) as unknown as Activity;
const GAMCHEON = place("Gamcheon Culture Village", 35.0975, 129.0106);
const SONGDO = place("Songdo Cable Car", 35.0758, 129.0166);
const day = (n: number, city: string, activities: Activity[]) => ({ day_number: n, city, activities }) as unknown as ItineraryDay;
const trip = (): ItineraryDay[] => [
  day(1, "Busan", [place("Haeundae Beach", 35.1587, 129.1604), place("Jagalchi Market", 35.0966, 129.0306)]),
  day(2, "Busan", [place("Taejongdae", 35.0517, 129.0848), place("BIFF Square", 35.0985, 129.0273)]),
  day(3, "Seoul", [place("KTX to Seoul", 35.1151, 129.0414, "transport"), place("Gyeongbokgung Palace", 37.5796, 126.977)]),
  day(4, "Seoul", [place("Bukchon Hanok Village", 37.5826, 126.9831), place("N Seoul Tower", 37.5512, 126.9882)]),
];
const edit = (n: number, activities: Activity[], city?: string): DayEdit => ({ day_number: n, summary: "", activities, ...(city ? { city } : {}) });
const names = (list: { activities: Activity[] }[]) => list.map((x) => x.activities.map((a) => a.name));

describe("keepDayCities", () => {
  it("keeps each day in its city, unless they name the new one", () => {
    expect(keepDayCities(trip(), [edit(3, [GAMCHEON], "Busan")], "cluster by areas")[0].city).toBeUndefined();
    expect(keepDayCities(trip(), [edit(3, [GAMCHEON], "Busan")], "spend day 3 in Busan instead")[0].city).toBe("Busan");
    // The same city in other words keeps the day's own name, and a new day keeps the one it's given.
    expect(keepDayCities(trip(), [edit(4, [], "Seoul, South Korea")], "make day 4 in Seoul calmer")[0].city).toBeUndefined();
    expect(keepDayCities(trip(), [edit(5, [], "Seoul")], "add a day")[0].city).toBe("Seoul");
  });
});

describe("placesAway", () => {
  it("finds another city's places a change puts on a day", () => {
    const away = placesAway(trip(), [edit(4, [GAMCHEON, place("N Seoul Tower", 37.5512, 126.9882), SONGDO])], "cluster by areas");
    expect(away).toEqual([{ day: 4, city: "Seoul", other: "Busan", activities: [GAMCHEON, SONGDO] }]);
  });

  it("checks the days asked for, and by default only the edited ones", () => {
    const mixed = trip().map((d) => (d.day_number === 4 ? { ...d, activities: [...d.activities, SONGDO] } : d));
    expect(placesAway(mixed, [edit(1, [GAMCHEON])], "cluster by areas")).toEqual([]);
    expect(names(placesAway(mixed, [edit(1, [GAMCHEON])], "cluster by areas", new Set([1, 2, 3, 4])))).toEqual([["Songdo Cable Car"]]);
  });

  it("leaves a day trip they asked for, a place they named, travel and places with no point", () => {
    const changed = [edit(4, [GAMCHEON, place("Lunch somewhere"), place("KTX back to Busan", 35.1151, 129.0414, "transport")])];
    expect(placesAway(trip(), changed, "a day trip to Busan on day 4")).toEqual([]);
    expect(placesAway(trip(), changed, "put Gamcheon on day 4 please")).toEqual([]);
    expect(names(placesAway(trip(), changed, "make day 4 calmer"))).toEqual([["Gamcheon Culture Village"]]);
  });

  // Taipei and Kaohsiung, with a day out to Taichung that the traveller put on day 3 on an earlier turn. Asked
  // next for photo times on each place, a change would take Taichung's places off it as Kaohsiung's: places 100 km
  // apart chain into one area from Taichung through Chiayi to Kaohsiung.
  it("leaves the places a day already had, unless they ask to regroup or name the city they're in", () => {
    const taiwan = [
      day(1, "Ximending", [place("Ximending Walking Street", 25.0421, 121.5075), place("Longshan Temple", 25.0372, 121.4999)]),
      day(2, "Ximending", [place("Jiufen Old Street", 25.1097, 121.8452), place("Shifen Old Street", 25.0485, 121.7756)]),
      day(3, "Ximending", [place("Taichung Old Station", 24.1371, 120.6852), place("Miyahara", 24.1376, 120.6838), place("Rainbow Village", 24.1335, 120.6098), place("Xitou Monster Village", 23.6747, 120.7966)]),
      day(4, "Kaohsiung", [place("National Chung Cheng University", 23.5621, 120.4734), place("Kaohsiung National Stadium", 22.7029, 120.2955)]),
      day(5, "Kaohsiung", [place("Alishan Forest Recreation Area", 23.5104, 120.8049), place("Pier-2 Art Center", 22.6204, 120.2817)]),
    ];
    const timed = edit(3, taiwan[2].activities.map((a, i) => ({ ...a, start_time: `${9 + 2 * i}:00` })));
    expect(placesAway(taiwan, [timed], "include the photo op time to each place and eating time to the restaurant you recommend")).toEqual([]);
    // A place the change brings to the day is still found.
    const brought = edit(3, [...timed.activities, place("Pier-2 Art Center", 22.6204, 120.2817)]);
    expect(names(placesAway(taiwan, [brought], "add photo times"))).toEqual([["Pier-2 Art Center"]]);
    // Asked to regroup, or about the other city's places, the day's own count too.
    expect(names(placesAway(taiwan, [timed], "cluster the days by area"))).toEqual([["Taichung Old Station", "Miyahara", "Rainbow Village", "Xitou Monster Village"]]);
    expect(names(placesAway(taiwan, [timed], "why are Kaohsiung places on day 3?"))).toEqual([["Taichung Old Station", "Miyahara", "Rainbow Village", "Xitou Monster Village"]]);
    // A place the day had under another wording is the same place.
    const renamed = edit(3, [{ ...taiwan[2].activities[0], name: "Taichung Old Station photo stop" }, ...taiwan[2].activities.slice(1)]);
    expect(placesAway(taiwan, [renamed], "add photo times")).toEqual([]);
    const shorter = edit(3, [...taiwan[2].activities.slice(0, 3), { ...taiwan[2].activities[3], name: "Monster Village" }]);
    expect(placesAway(taiwan, [shorter], "add photo times")).toEqual([]);
    // A stop with no name on the day is no trouble.
    const nameless = taiwan.map((d) => (d.day_number === 3 ? { ...d, activities: [{ start_time: "08:00" } as unknown as Activity, ...d.activities] } : d));
    expect(placesAway(nameless, [timed], "add photo times")).toEqual([]);
    expect(withoutPlacesAway(taiwan, [timed], "add photo times")).toEqual({ edits: [timed], away: [] });
  });

  it("finds nothing on a trip to one place, or between cities close together", () => {
    const oneCity = trip().map(({ city: _city, ...d }) => d as ItineraryDay);
    expect(placesAway(oneCity, [edit(4, [GAMCHEON])], "cluster")).toEqual([]);
    const kansai = [day(1, "Kyoto", [place("Fushimi Inari", 34.9671, 135.7727)]), day(2, "Osaka", [place("Dotonbori", 34.6687, 135.5013)])];
    expect(placesAway(kansai, [edit(1, [place("Osaka Castle", 34.6873, 135.5262)])], "cluster")).toEqual([]);
  });
});

describe("withoutPlacesAway", () => {
  it("takes another city's places off the edited days, and says which", () => {
    const { edits, away } = withoutPlacesAway(trip(), [edit(2, [GAMCHEON]), edit(4, [SONGDO, place("N Seoul Tower", 37.5512, 126.9882)])], "regroup");
    expect(names(edits)).toEqual([["Gamcheon Culture Village"], ["N Seoul Tower"]]);
    expect(away).toEqual([{ day: 4, city: "Seoul", other: "Busan", activities: [SONGDO] }]);
  });

  // A later part gave Seoul's last day back with only Busan's sights on it: taken
  // off, the day was empty, and two must-dos were gone with it.
  it("leaves a day as it was rather than empty", () => {
    const { edits, away } = withoutPlacesAway(trip(), [edit(2, [GAMCHEON]), edit(4, [SONGDO, GAMCHEON])], "regroup");
    expect(edits.map((e) => e.day_number)).toEqual([2]);
    expect(away).toEqual([]);
  });

  it("empties a day whose places are only copies of ones on their city's days", () => {
    const { edits, away } = withoutPlacesAway(trip(), [edit(2, [GAMCHEON, SONGDO]), edit(4, [SONGDO, GAMCHEON])], "regroup");
    expect(names(edits)).toEqual([["Gamcheon Culture Village", "Songdo Cable Car"], []]);
    expect(away).toEqual([{ day: 4, city: "Seoul", other: "Busan", activities: [SONGDO, GAMCHEON] }]);
    // A copy on another day of the wrong city doesn't count.
    const withCopy = trip().map((d) => (d.day_number === 3 ? { ...d, activities: [...d.activities, GAMCHEON] } : d));
    expect(withoutPlacesAway(withCopy, [edit(4, [GAMCHEON])], "regroup").edits).toEqual([]);
  });
});
