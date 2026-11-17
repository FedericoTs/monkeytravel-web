import { describe, expect, it } from "vitest";
import { keepOffClosingDays, type Weekday } from "@/lib/ai/closing-days";
import { KNOWN_CLOSINGS, knownClosingFor, shutBy, withKnownClosings, type KnownClosing } from "@/lib/ai/known-closings";

const entry = (name: string, destination: string) => {
  const found = knownClosingFor(name, destination);
  if (!found) throw new Error(`${name} is not on the list for ${destination}`);
  return found;
};

describe("a Japanese museum's Mondays", () => {
  const tnm = entry("Tokyo National Museum", "Tokyo, Japan");

  it("shuts an ordinary Monday and opens the Tuesday", () => {
    expect(shutBy(tnm, "2027-01-18")).toBe(true);
    expect(shutBy(tnm, "2027-01-19")).toBe(false);
  });

  it("opens a Monday that is a national holiday and shuts the Tuesday after it", () => {
    expect(shutBy(tnm, "2027-01-11")).toBe(false);
    expect(shutBy(tnm, "2027-01-12")).toBe(true);
    expect(shutBy(tnm, "2027-01-13")).toBe(false);
  });

  it("moves the closure past a run of holidays to the first ordinary day", () => {
    const gyoen = entry("Shinjuku Gyoen National Garden", "Tokyo");
    // Monday 21, Tuesday 22 and Wednesday 23 September 2026 are all holidays.
    expect(shutBy(gyoen, "2026-09-21")).toBe(false);
    expect(shutBy(gyoen, "2026-09-23")).toBe(false);
    expect(shutBy(gyoen, "2026-09-24")).toBe(true);
    expect(shutBy(gyoen, "2026-09-25")).toBe(false);
  });

  it("keeps its year-end closure, and is open again on the day the list doesn't shut", () => {
    for (const date of ["2026-12-26", "2026-12-29", "2026-12-31"]) expect(shutBy(tnm, date)).toBe(true);
    expect(shutBy(tnm, "2026-12-25")).toBe(false);
    expect(shutBy(tnm, "2027-01-01")).toBe(false);
  });
});

describe("the other rules", () => {
  it("shuts the Met on Wednesdays and on Thanksgiving, the fourth Thursday of November", () => {
    const met = entry("The Metropolitan Museum of Art", "New York City");
    expect(shutBy(met, "2026-11-25")).toBe(true);
    expect(shutBy(met, "2026-11-26")).toBe(true);
    expect(shutBy(met, "2026-11-19")).toBe(false);
    expect(shutBy(met, "2027-11-25")).toBe(true);
    expect(shutBy(met, "2026-12-25")).toBe(true);
    expect(shutBy(met, "2026-11-27")).toBe(false);
  });

  it("shuts the Vatican Museums on Sundays but the last, and on 25 and 26 December", () => {
    const vatican = entry("Vatican Museums & Sistine Chapel", "Rome, Italy");
    expect(shutBy(vatican, "2026-11-22")).toBe(true);
    expect(shutBy(vatican, "2026-11-29")).toBe(false);
    expect(shutBy(vatican, "2026-12-25")).toBe(true);
    expect(shutBy(vatican, "2026-12-26")).toBe(true);
    expect(shutBy(vatican, "2026-12-27")).toBe(false);
    expect(shutBy(vatican, "2026-11-23")).toBe(false);
  });

  it("shuts on the nth weekday of a month", () => {
    const place: KnownClosing = { names: /x/, city: /y/, rules: [{ nth: "Tuesday", of: [2, 4] }], source: "" };
    expect(shutBy(place, "2026-12-08")).toBe(true);
    expect(shutBy(place, "2026-12-22")).toBe(true);
    expect(shutBy(place, "2026-12-01")).toBe(false);
    expect(shutBy(place, "2026-12-15")).toBe(false);
  });

  it("opens on a day its rules would shut, when the list says so", () => {
    const place: KnownClosing = { names: /x/, city: /y/, rules: [{ weekly: ["Monday"] }], openOn: ["2026-12-07"], source: "" };
    expect(shutBy(place, "2026-12-07")).toBe(false);
    expect(shutBy(place, "2026-12-14")).toBe(true);
  });

  it("decides nothing for a date it can't read", () => {
    expect(shutBy(entry("Louvre Museum", "Paris"), "not a date")).toBe(false);
  });
});

describe("closures the official pages state for every year", () => {
  const shutOn = (name: string, city: string, dates: string[]) => dates.filter((date) => shutBy(entry(name, city), date));

  it("shut a span that runs into the new year, in a year the list's dates were never checked for", () => {
    // Wednesday 29 December 2027 to Monday 3 January 2028; the Tuesdays either side are open.
    const span = ["2027-12-28", "2027-12-29", "2027-12-31", "2028-01-01", "2028-01-03", "2028-01-04"];
    expect(shutOn("Shinjuku Gyoen National Garden", "Tokyo", span)).toEqual(span.slice(1, 5));
    expect(shutOn("Imperial Palace East Gardens", "Tokyo", span)).toEqual(span.slice(0, 5));
    expect(shutOn("Hama-rikyu Gardens", "Tokyo", [...span, "2028-01-02"])).toEqual(["2027-12-29", "2027-12-31", "2028-01-01"]);
    expect(shutOn("Kyoto Imperial Palace", "Kyoto", [...span, "2028-01-05"])).toEqual(span);
  });

  it("keep the decks open on New Year's Day between their two closures", () => {
    const days = ["2027-12-28", "2027-12-29", "2027-12-31", "2028-01-01", "2028-01-02", "2028-01-03", "2028-01-04"];
    expect(shutOn("Tokyo Metropolitan Government Building", "Tokyo", days)).toEqual(["2027-12-29", "2027-12-31", "2028-01-02", "2028-01-03"]);
  });

  it("shut the same days each year in Paris, Rome, London and New York", () => {
    const days = ["2027-05-01", "2027-05-02", "2027-12-24", "2027-12-25", "2027-12-26", "2028-01-01", "2028-05-01"];
    expect(shutOn("Louvre Museum", "Paris", days)).toEqual(["2027-05-01", "2027-12-25", "2028-01-01", "2028-05-01"]);
    expect(shutOn("Sainte-Chapelle", "Paris", days)).toEqual(["2027-05-01", "2027-12-25", "2028-01-01", "2028-05-01"]);
    // Orsay's Monday is 1 May 2028 anyway.
    expect(shutOn("Musée d'Orsay", "Paris", days)).toEqual(["2027-05-01", "2027-12-25", "2028-05-01"]);
    expect(shutOn("Pantheon", "Rome", days)).toEqual(["2027-12-25", "2028-01-01"]);
    expect(shutOn("Castel Sant'Angelo", "Rome", days)).toEqual(["2027-12-25", "2028-01-01", "2028-05-01"]);
    // The Capitoline Museums open on New Year's Day.
    expect(shutOn("Capitoline Museums", "Rome", days)).toEqual(["2027-05-01", "2027-12-25", "2028-05-01"]);
    expect(shutOn("Natural History Museum", "London", [...days, "2027-12-27"])).toEqual(["2027-12-24", "2027-12-25", "2027-12-26"]);
    expect(shutOn("Statue of Liberty", "New York", days)).toEqual(["2027-12-25"]);
  });

  it("open a garden every day of its seasons, Mondays included, and shut its Mondays outside them", () => {
    const mondays = ["2027-03-15", "2027-03-29", "2028-04-03", "2028-04-24", "2027-04-26", "2027-11-01", "2027-11-15", "2027-11-22"];
    expect(shutOn("Shinjuku Gyoen", "Tokyo", mondays)).toEqual(["2027-03-15", "2027-04-26", "2027-11-22"]);
  });

  it("past the checked window, shut a sight on its New Year closure though the model said nothing", () => {
    const days = [
      { date: "2027-12-30", activities: [{ name: "Shinjuku Gyoen National Garden" }] },
      { date: "2028-01-04", activities: [{ name: "Kyoto Imperial Palace" }] },
    ];
    const silent = { closings: new Map<string, Weekday[]>(), shutDates: new Map<string, string[]>() };
    expect(withKnownClosings(silent, days, "Tokyo").shutDates.get("shinjuku gyoen national garden")).toEqual(["2027-12-30"]);
    // The palace is shut on both of the trip's dates (28 December to 4 January).
    expect(withKnownClosings(silent, days, "Kyoto").shutDates.get("kyoto imperial palace")).toEqual(["2027-12-30", "2028-01-04"]);
  });
});

describe("the list's entries", () => {
  it("each name an official https page", () => {
    for (const place of KNOWN_CLOSINGS) expect(place.source).toMatch(/^https:\/\/[^\s]+$/);
  });

  it("tell a market from the park beside it, and a garden from the palace's open grounds", () => {
    expect(knownClosingFor("Chatuchak Weekend Market", "Bangkok")).toBeDefined();
    expect(knownClosingFor("Chatuchak Park", "Bangkok")).toBeUndefined();
    expect(knownClosingFor("Imperial Palace East Gardens", "Tokyo")).toBeDefined();
    expect(knownClosingFor("Tokyo Imperial Palace & Nijubashi Bridge", "Tokyo")).toBeUndefined();
  });

  it("keep their dated exceptions", () => {
    const garden = entry("Imperial Palace East Gardens", "Tokyo");
    expect(shutBy(garden, "2026-11-30")).toBe(false);
    expect(shutBy(garden, "2026-12-07")).toBe(true);
    expect(shutBy(garden, "2026-11-24")).toBe(true);
    const market = entry("Chatuchak Weekend Market", "Bangkok");
    expect(shutBy(market, "2026-12-07")).toBe(true);
    expect(shutBy(market, "2026-12-11")).toBe(false);
    const borough = entry("Borough Market", "London");
    expect(shutBy(borough, "2026-12-14")).toBe(false);
    expect(shutBy(borough, "2027-01-11")).toBe(true);
    expect(shutBy(borough, "2026-12-26")).toBe(true);
  });
});

describe("which stop is a listed place", () => {
  it("matches by name in its own city only", () => {
    expect(knownClosingFor("Louvre Museum", "Paris, France")?.source).toContain("louvre.fr");
    expect(knownClosingFor("Musée du Louvre", "Parigi")).toBeDefined();
    expect(knownClosingFor("Louvre Abu Dhabi", "Paris")).toBeUndefined();
    expect(knownClosingFor("Louvre Museum", "London")).toBeUndefined();
    expect(knownClosingFor(undefined, "Paris")).toBeUndefined();
  });
});

describe("the list decides its places over the model's answer", () => {
  // Monday 28 to Wednesday 30 December 2026.
  const days = [
    { date: "2026-12-28", activities: [{ name: "Louvre Museum" }, { name: "Musée de l'Orangerie" }] },
    { date: "2026-12-29", activities: [{ name: "Canal Saint-Martin walk" }] },
    { date: "2026-12-30", activities: [{ name: "louvre museum " }] },
  ];

  it("drops the model's wrong weekday for a listed place and keeps its answer for the others", () => {
    const answer = {
      closings: new Map<string, Weekday[]>([["louvre museum", ["Monday"]], ["musée de l'orangerie", ["Tuesday"]]]),
      shutDates: new Map<string, string[]>([["louvre museum", ["2026-12-30"]]]),
    };
    const merged = withKnownClosings(answer, days, "Paris");
    expect(merged.closings.has("louvre museum")).toBe(false);
    expect(merged.shutDates.get("louvre museum")).toEqual(["2026-12-29"]);
    expect(merged.closings.get("musée de l'orangerie")).toEqual(["Tuesday"]);
    expect(merged.known).toBe(1);
    expect(answer.closings.get("louvre museum")).toEqual(["Monday"]);
  });

  it("clears a listed place's dates when the list shuts it on none of the trip's days", () => {
    const answer = { closings: new Map<string, Weekday[]>(), shutDates: new Map([["louvre museum", ["2026-12-28"]]]) };
    const merged = withKnownClosings(answer, [days[0]], "Paris");
    expect(merged.shutDates.has("louvre museum")).toBe(false);
  });

  it("keeps a place open every day from being moved by a wrong answer", () => {
    const answer = { closings: new Map<string, Weekday[]>([["fushimi inari-taisha", ["Monday"]]]), shutDates: new Map<string, string[]>() };
    const merged = withKnownClosings(answer, [{ date: "2026-12-28", activities: [{ name: "Fushimi Inari-taisha" }] }], "Kyoto");
    expect(merged.closings.has("fushimi inari-taisha")).toBe(false);
    expect(merged.shutDates.has("fushimi inari-taisha")).toBe(false);
    expect(merged.known).toBe(1);
  });

  it("past the checked window, adds the list's dates to the model's answer instead of replacing it", () => {
    // Friday 24 and Saturday 25 December 2027: the list hasn't checked that Christmas; the model says it's shut.
    const later = [
      { date: "2027-12-24", activities: [{ name: "Louvre Museum" }] },
      { date: "2027-12-28", activities: [{ name: "Musée du Louvre" }] },
    ];
    const answer = {
      closings: new Map<string, Weekday[]>([["louvre museum", ["Tuesday"]]]),
      shutDates: new Map<string, string[]>([["louvre museum", ["2027-12-25"]]]),
    };
    const merged = withKnownClosings(answer, later, "Paris");
    expect(merged.closings.get("louvre museum")).toEqual(["Tuesday"]);
    expect(merged.shutDates.get("louvre museum")).toEqual(["2027-12-25", "2027-12-28"]);
    // The weekly Tuesday still holds past the window, for a name the model wasn't asked about.
    expect(merged.shutDates.get("musée du louvre")).toEqual(["2027-12-28"]);
  });

  it("moves a listed sight off its closing day even when the model said nothing about it", async () => {
    // Tokyo: Tuesday 12 January 2027 (shut, the day after a holiday Monday) and Wednesday 13 (open).
    const plan = {
      days: [
        { day_number: 1, date: "2027-01-12", activities: [{ name: "Tokyo National Museum", type: "museum", start_time: "10:00", duration_minutes: 120 }] },
        { day_number: 2, date: "2027-01-13", activities: [{ name: "Meiji Jingu Shrine", type: "landmark", start_time: "10:00", duration_minutes: 90 }] },
      ],
    };
    const silent = async () => ({ closings: new Map<string, Weekday[]>(), shutDates: new Map<string, string[]>(), costUsd: 0 });
    const words = async (days: typeof plan.days) => ({ days, costUsd: 0, reworded: 0 });
    const result = await keepOffClosingDays(plan, "Tokyo, Japan", silent, words as never);
    // Both are listed: the museum by its Mondays, the shrine as open every day.
    expect(result.known).toBe(2);
    expect(result.shutBefore).toBe(1);
    expect(result.shutAfter).toBe(0);
    expect(result.itinerary.days[1].activities.map((a) => a.name)).toContain("Tokyo National Museum");
  });
});
