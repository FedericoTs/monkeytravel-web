import { describe, expect, it } from "vitest";
import { keepOffClosingDays, type Weekday } from "@/lib/ai/closing-days";
import { KNOWN_CLOSINGS, hoursOn, knownClosingFor, shutBy, withClosingNotes, withKnownClosings, type KnownClosing } from "@/lib/ai/known-closings";

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

  it("opens Shinjuku Gyoen on the cherry-blossom Monday its calendar lists", () => {
    const gyoen = entry("Shinjuku Gyoen", "Tokyo");
    expect(shutBy(gyoen, "2027-03-29")).toBe(false);
    expect(shutBy(gyoen, "2027-03-15")).toBe(true);
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
    // The Galleria Borghese's Monday is 1 May 2028.
    expect(shutOn("Galleria Borghese", "Rome", days)).toEqual(["2027-12-25", "2028-01-01", "2028-05-01"]);
    expect(shutOn("Natural History Museum", "London", [...days, "2027-12-27"])).toEqual(["2027-12-24", "2027-12-25", "2027-12-26"]);
    expect(shutOn("Statue of Liberty", "New York", days)).toEqual(["2027-12-25"]);
  });

  it("shut Barcelona's Boqueria on its holidays, and New York's Whitney on Thanksgiving but not on its open December Tuesdays", () => {
    const winter = ["2026-11-26", "2026-12-15", "2026-12-22", "2026-12-24", "2026-12-25", "2026-12-26", "2026-12-27", "2026-12-29", "2027-01-01", "2027-01-06"];
    expect(shutOn("Mercat de la Boqueria", "Barcelona", winter)).toEqual(["2026-12-25", "2026-12-26", "2026-12-27", "2027-01-01", "2027-01-06"]);
    expect(shutOn("Whitney Museum of American Art", "New York", winter)).toEqual(["2026-11-26", "2026-12-15", "2026-12-25"]);
  });

  it("shut the Acropolis on Orthodox Easter Sunday, whose date moves, and not on the Western one", () => {
    // Western Easter 5 April 2026 and 28 March 2027; Orthodox 12 April 2026 and 2 May 2027; both 16 April 2028.
    const days = ["2026-04-05", "2026-04-12", "2027-03-28", "2027-05-01", "2027-05-02", "2027-05-03", "2028-04-16"];
    expect(shutOn("Acropolis of Athens", "Athens", days)).toEqual(["2026-04-12", "2027-05-01", "2027-05-02", "2028-04-16"]);
    // The Ancient Agora below it keeps the same days; the Roman Agora isn't it.
    expect(shutOn("Ancient Agora of Athens", "Athens", days)).toEqual(["2026-04-12", "2027-05-01", "2027-05-02", "2028-04-16"]);
    expect(knownClosingFor("Roman Agora of Athens", "Athens")).toBeUndefined();
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

describe("Tokyo's metropolitan gardens", () => {
  // Tuesday 28 December 2027 to Tuesday 4 January 2028.
  const days = ["2027-12-28", "2027-12-29", "2027-12-31", "2028-01-01", "2028-01-02", "2028-01-03", "2028-01-04"];
  const shutOn = (name: string) => days.filter((date) => shutBy(entry(name, "Tokyo, Japan"), date));

  it.each([
    "Rikugien Garden",
    "Koishikawa Korakuen Garden",
    "Kiyosumi Gardens",
    "Kyu-Shiba-rikyu Garden",
    "Kyu-Furukawa Gardens",
    "Kyu-Iwasaki-tei Gardens",
    "Tonogayato Garden",
    "Hama-rikyu Gardens",
  ])("shut %s from 29 December to 1 January, and open it every other day", (name) => {
    expect(shutOn(name)).toEqual(["2027-12-29", "2027-12-31", "2028-01-01"]);
    // An ordinary week: no weekly closing day.
    expect(["2027-11-15", "2027-11-16", "2027-11-17", "2027-11-18", "2027-11-19", "2027-11-20", "2027-11-21"].some((date) => shutBy(entry(name, "Tokyo"), date))).toBe(false);
  });

  it("shut Mukojima-Hyakkaen until 3 January", () => {
    expect(shutOn("Mukojima-Hyakkaen Garden")).toEqual(["2027-12-29", "2027-12-31", "2028-01-01", "2028-01-02", "2028-01-03"]);
  });

  it("know them by their Japanese names too", () => {
    for (const name of ["六義園", "小石川後楽園", "清澄庭園", "旧芝離宮恩賜庭園", "旧古河庭園", "旧岩崎邸庭園", "殿ヶ谷戸庭園", "向島百花園"]) {
      expect(knownClosingFor(name, "Tokyo")).toBeDefined();
    }
  });

  it("leave out the places that only share a name", () => {
    expect(knownClosingFor("Koishikawa Botanical Garden", "Tokyo")).toBeUndefined();
    expect(knownClosingFor("Blue Bottle Coffee Kiyosumi-Shirakawa", "Tokyo")).toBeUndefined();
    expect(knownClosingFor("Kiyosumi Shirakawa coffee crawl", "Tokyo")).toBeUndefined();
  });
});

describe("the list's entries", () => {
  it("each name an official https page", () => {
    for (const place of KNOWN_CLOSINGS) expect(place.source).toMatch(/^https:\/\/[^\s]+$/);
    for (const place of KNOWN_CLOSINGS.filter((p) => p.hoursSource)) expect(place.hoursSource).toMatch(/^https:\/\/[^\s]+$/);
  });

  it("keep a winter visit to the Tokyo gardens inside their official hours", () => {
    // Thursday 28 January 2027.
    expect(hoursOn(entry("Imperial Palace East Gardens", "Tokyo"), "2027-01-28")).toEqual({ open: 540, close: 960, lastEntry: 930 });
    expect(hoursOn(entry("Shinjuku Gyoen", "Tokyo"), "2027-01-28")).toEqual({ open: 540, close: 990, lastEntry: 960 });
    // The Louvre stays open late on Fridays, and the Acropolis Museum isn't the Acropolis.
    expect(hoursOn(entry("Louvre Museum", "Paris"), "2027-01-29")?.close).toBe(21 * 60);
    expect(hoursOn(entry("Louvre Museum", "Paris"), "2027-01-28")?.close).toBe(18 * 60);
    expect(knownClosingFor("Acropolis Museum", "Athens")).toBeUndefined();
    expect(hoursOn(entry("Acropolis", "Athens"), "2027-01-28")).toEqual({ open: 480, close: 1020, lastEntry: 1000 });
  });

  it("tell the Colosseum from the Square Colosseum across Rome, which keeps none of its hours", () => {
    // Thursday 26 November 2026: the Colosseum's last entry is 15:30.
    expect(hoursOn(entry("Colosseum", "Rome"), "2026-11-26")?.lastEntry).toBe(15 * 60 + 30);
    expect(knownClosingFor("Colosseo", "Rome, Italy")).toBeDefined();
    expect(knownClosingFor("Colosseo Quadrato (Palazzo della Civiltà Italiana)", "Rome, Italy")).toBeUndefined();
    expect(knownClosingFor("Square Colosseum", "Rome")).toBeUndefined();
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
    // And says so on the stop, with the museum's own page; the shrine, open every day, says nothing.
    const museum = result.itinerary.days[1].activities.find((a) => a.name === "Tokyo National Museum") as { closing?: unknown };
    expect(museum.closing).toEqual({ dates: ["2027-01-12"], source: "https://www.tnm.jp/modules/r_free_page/index.php?id=113&lang=en" });
    expect(result.itinerary.days.flatMap((d) => d.activities).find((a) => a.name === "Meiji Jingu Shrine")).not.toHaveProperty("closing");
  });
});

describe("a listed place's hours on a date", () => {
  const garden: KnownClosing = {
    names: /\bgarden\b/i,
    city: /\btokyo\b/i,
    rules: [{ weekly: ["Monday"] }],
    hours: [
      { from: "10-01", to: "03-14", open: "09:00", close: "16:00", lastEntry: "15:30" },
      { from: "03-15", to: "09-30", days: ["Saturday"], open: "09:00", close: "19:00" },
      { from: "03-15", to: "09-30", open: "09:00", close: "17:30", lastEntry: "17:00" },
    ],
    source: "https://example.test/hours",
  };
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

  it("takes the first row whose season and weekday hold, a season running into the new year included", () => {
    expect(hoursOn(garden, "2027-01-28")).toEqual({ open: minutes("09:00"), close: minutes("16:00"), lastEntry: minutes("15:30") });
    expect(hoursOn(garden, "2026-12-31")).toEqual({ open: minutes("09:00"), close: minutes("16:00"), lastEntry: minutes("15:30") });
    expect(hoursOn(garden, "2027-05-15")).toEqual({ open: minutes("09:00"), close: minutes("19:00") });
    expect(hoursOn(garden, "2027-05-14")).toEqual({ open: minutes("09:00"), close: minutes("17:30"), lastEntry: minutes("17:00") });
  });

  it("has none on a day the place is shut, a date it can't read, or a place without hours", () => {
    expect(hoursOn(garden, "2027-01-25")).toBeNull();
    expect(hoursOn(garden, "28/01/2027")).toBeNull();
    expect(hoursOn({ ...garden, hours: undefined }, "2027-01-28")).toBeNull();
    expect(hoursOn({ ...garden, hours: [{ from: "04-01", to: "04-30", open: "09:00", close: "17:00" }] }, "2027-01-28")).toBeNull();
  });

  it("lists hours only as whole times of day, each season opening before it closes", () => {
    for (const place of KNOWN_CLOSINGS) {
      for (const row of place.hours ?? []) {
        for (const time of [row.open, row.close, ...(row.lastEntry ? [row.lastEntry] : [])]) expect(time).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
        for (const monthDay of [row.from, row.to]) expect(monthDay).toMatch(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
        expect(minutes(row.open)).toBeLessThan(minutes(row.close));
        if (row.lastEntry) expect(minutes(row.lastEntry)).toBeLessThanOrEqual(minutes(row.close));
      }
    }
  });
});

describe("more sights that close early", () => {
  it("shut the Musée Rodin on Mondays, and keep Tate Modern open late on Fridays", () => {
    // Monday 25 January 2027; Thursday 28 and Friday 29.
    expect(shutBy(entry("Musée Rodin", "Paris"), "2027-01-25")).toBe(true);
    expect(hoursOn(entry("Tate Modern", "London"), "2027-01-29")?.close).toBe(21 * 60);
    expect(hoursOn(entry("Tate Modern", "London"), "2027-01-28")?.close).toBe(18 * 60);
  });

  it("shut Eravikulam while the tahr calve, and tell Osaka Castle's park from its tower", () => {
    expect(shutBy(entry("Eravikulam National Park", "Munnar, Kerala"), "2027-02-15")).toBe(true);
    expect(shutBy(entry("Eravikulam National Park", "Munnar, Kerala"), "2027-04-02")).toBe(false);
    expect(knownClosingFor("Osaka Castle Park", "Osaka")).toBeUndefined();
    expect(hoursOn(entry("Osaka Castle", "Osaka, Japan"), "2027-01-28")).toEqual({ open: 540, close: 1080, lastEntry: 1050 });
  });

  it("find Bali's sights on a trip named after any of its towns", () => {
    expect(knownClosingFor("Sacred Monkey Forest Sanctuary", "UBUD, Uluwati, Canga & Seminyak")).toBeDefined();
    expect(knownClosingFor("Tirta Empul Temple", "Bali, Indonesia")).toBeDefined();
    expect(knownClosingFor("Tirta Empul Temple", "Lisbon")).toBeUndefined();
  });
});

// The Taj Mahal shuts on Fridays, and a plan could put it there: India's most-visited sights, from official pages.
describe("India's sights", () => {
  // Monday 25 January 2027, Tuesday 26 (Republic Day), Thursday 28, Friday 29; Monday 1 February.
  it("shut the Taj Mahal on Fridays, and leave the hotel and the views named after it", () => {
    expect(shutBy(entry("Taj Mahal", "Agra"), "2027-01-29")).toBe(true);
    expect(shutBy(entry("Taj Mahal at sunrise", "Delhi & Agra"), "2027-01-28")).toBe(false);
    expect(knownClosingFor("Taj Mahal Palace", "Agra")).toBeUndefined();
    expect(knownClosingFor("Taj Mahal view from Mehtab Bagh", "Agra")).toBeUndefined();
    expect(knownClosingFor("Taj Mahal", "Mumbai")).toBeUndefined();
  });

  it("open the Red Fort on Mondays now, shut it before Independence Day, and tell Agra's red fort from it", () => {
    expect(shutBy(entry("Red Fort", "New Delhi"), "2027-02-01")).toBe(false);
    expect(shutBy(entry("Lal Qila (Red Fort)", "Delhi"), "2027-08-01")).toBe(true);
    expect(knownClosingFor("Agra Fort (the Red Fort of Agra)", "Delhi & Agra")).toBeUndefined();
  });

  it("shut Delhi's museums and temples on Mondays, the National Museum on the national holidays too", () => {
    const museum = entry("National Museum", "New Delhi, India");
    expect(shutBy(museum, "2027-01-25")).toBe(true);
    expect(shutBy(museum, "2027-01-26")).toBe(true);
    expect(shutBy(museum, "2027-01-28")).toBe(false);
    expect(hoursOn(museum, "2027-01-30")?.close).toBe(20 * 60);
    expect(hoursOn(museum, "2027-01-28")?.close).toBe(18 * 60);
    expect(shutBy(entry("Swaminarayan Akshardham", "Delhi"), "2027-02-01")).toBe(true);
    expect(shutBy(entry("Lotus Temple", "Nueva Delhi"), "2027-02-01")).toBe(true);
    expect(knownClosingFor("National Museum", "Mumbai")).toBeUndefined();
  });

  it("shut the caves on their own days", () => {
    expect(shutBy(entry("Ajanta Caves", "Aurangabad"), "2027-01-25")).toBe(true);
    expect(shutBy(entry("Ellora Caves", "Ajanta & Ellora"), "2027-01-26")).toBe(true);
    expect(shutBy(entry("Ellora Caves", "Chhatrapati Sambhajinagar"), "2027-01-25")).toBe(false);
    expect(shutBy(entry("Elephanta Caves", "Mumbai"), "2027-01-25")).toBe(true);
    expect(hoursOn(entry("Elephanta Caves", "Bombay"), "2027-01-28")?.close).toBe(17 * 60 + 30);
  });

  it("shut Hyderabad's palace and museum, Kochi's palace and Chennai's museum on Fridays", () => {
    expect(shutBy(entry("Salar Jung Museum", "Hyderabad"), "2027-01-29")).toBe(true);
    expect(shutBy(entry("Chowmahalla Palace", "Hyderabad, India"), "2027-01-29")).toBe(true);
    expect(shutBy(entry("Mattancherry Palace", "Kochi"), "2027-01-29")).toBe(true);
    expect(shutBy(entry("Dutch Palace", "Fort Kochi, Kerala"), "2027-01-28")).toBe(false);
    expect(shutBy(entry("Government Museum", "Chennai"), "2027-01-29")).toBe(true);
    expect(shutBy(entry("Government Museum", "Chennai"), "2027-08-15")).toBe(true);
  });

  it("keep Mehrangarh, Mumbai's museum and Mysore Palace inside their hours", () => {
    expect(hoursOn(entry("Mehrangarh Fort", "Jodhpur"), "2027-01-28")).toEqual({ open: 540, close: 1020 });
    expect(hoursOn(entry("Chhatrapati Shivaji Maharaj Vastu Sangrahalaya", "Mumbai"), "2027-01-28")).toEqual({ open: 615, close: 1080, lastEntry: 1065 });
    expect(shutBy(entry("CSMVS (Prince of Wales Museum)", "Mumbai"), "2027-05-01")).toBe(true);
    expect(hoursOn(entry("Mysore Palace", "Mysuru"), "2027-01-28")).toEqual({ open: 600, close: 1050, lastEntry: 1020 });
  });
});

describe("a meal named after a listed place", () => {
  it("is never the place: a restaurant by the Pantheon isn't shut on its holidays", () => {
    const days = [{ date: "2026-12-25", activities: [{ name: "Armando al Pantheon", type: "restaurant" }, { name: "Pantheon", type: "landmark" }] }];
    const none = { closings: new Map<string, Weekday[]>(), shutDates: new Map<string, string[]>() };
    const merged = withKnownClosings(none, days, "Rome");
    expect(merged.known).toBe(1);
    expect(merged.shutDates.get("armando al pantheon")).toBeUndefined();
    expect(merged.shutDates.get("pantheon")).toEqual(["2026-12-25"]);
  });
});

// Plans moved sights off their closing days without a word, while a chat names each closure. The checked list says it
// on the stop, with the official page: only the list, since the model's word on a closing day changes between calls.
describe("closures said on the stop", () => {
  const LOUVRE = "https://www.louvre.fr/en/visit/hours-admission";
  const stop = (name: string, type = "museum") => ({ name, type });
  const on = (date: string, names: string[], city?: string) => ({ date, ...(city ? { city } : {}), activities: names.map((n) => stop(n)) });

  it("names the trip's dates a listed place is shut on, with its official page", () => {
    // Monday 14 to Thursday 17 December 2026: the Louvre shuts on Tuesdays.
    const days = [on("2026-12-14", ["Louvre Museum"]), on("2026-12-15", ["Canal Saint-Martin walk"]), on("2026-12-16", []), on("2026-12-17", [])];
    const noted = withClosingNotes(days, "Paris");
    expect(noted[0].activities[0]).toEqual({ name: "Louvre Museum", type: "museum", closing: { dates: ["2026-12-15"], source: LOUVRE } });
    expect(noted[1].activities[0]).not.toHaveProperty("closing");
  });

  it("says nothing on a trip with none of its closing days, and gives the same days back", () => {
    // Wednesday 16 to Friday 18 December.
    const days = [on("2026-12-16", ["Louvre Museum"]), on("2026-12-17", []), on("2026-12-18", [])];
    expect(withClosingNotes(days, "Paris")).toBe(days);
  });

  it("names a holiday too, and never a meal named after a sight", () => {
    // Thursday 24 to Saturday 26 December.
    const days = [24, 25, 26].map((d) => ({ date: `2026-12-${d}`, activities: [stop("Louvre Museum"), stop("Café du Louvre", "restaurant")] }));
    const noted = withClosingNotes(days, "Paris");
    expect(noted[0].activities[0]).toHaveProperty("closing", { dates: ["2026-12-25"], source: LOUVRE });
    expect(noted[0].activities[1]).not.toHaveProperty("closing");
  });

  it("on a trip through several cities, counts only the dates of the stop's own city", () => {
    // Rome on Monday 14 and Tuesday 15, Paris on Wednesday 16 and Thursday 17: the Louvre's Tuesday is a Rome day.
    const days = [
      on("2026-12-14", ["Trevi Fountain"], "Rome"),
      on("2026-12-15", ["Villa Borghese"], "Rome"),
      on("2026-12-16", ["Louvre Museum"], "Paris"),
      on("2026-12-17", ["Sainte-Chapelle"], "Paris"),
    ];
    expect(withClosingNotes(days, "Rome & Paris")[2].activities[0]).not.toHaveProperty("closing");
    // With the Tuesday in Paris, it is said.
    const parisTuesday = [on("2026-12-14", ["Trevi Fountain"], "Rome"), on("2026-12-15", ["Louvre Museum"], "Paris"), on("2026-12-16", [], "Paris")];
    // The day's own city finds the place, whatever the trip is called.
    expect(withClosingNotes(parisTuesday, "Our grand tour")[1].activities[0]).toHaveProperty("closing", { dates: ["2026-12-15"], source: LOUVRE });
  });

  it("says nothing past the window the list was checked for", () => {
    const days = [on("2027-06-15", ["Louvre Museum"]), on("2027-06-16", [])];
    expect(withClosingNotes(days, "Paris")).toBe(days);
  });
});
