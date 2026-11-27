import { describe, it, expect } from "vitest";
import { createTranslator } from "next-intl";
import en from "@/messages/en/common.json";
import es from "@/messages/es/common.json";
import itMessages from "@/messages/it/common.json";
import pt from "@/messages/pt/common.json";
import { buildTripStory, plainName, STORY_DAY_SLIDES, type StoryClue, type StorySource } from "./trip-story";

const stop = (name: string, type: string, lat?: number, lng?: number, extra: Record<string, unknown> = {}) => ({
  name,
  type,
  ...(lat === undefined ? {} : { coordinates: { lat, lng } }),
  ...extra,
});

const lisbonDays = [
  {
    day_number: 1,
    date: "2027-01-09",
    title: "Alfama and the river",
    activities: [
      stop("Hotel Avenida Palace", "accommodation", 38.7155, -9.1414),
      stop("Pastéis de Belém", "cafe", 38.6975, -9.2032),
      stop("Jerónimos Monastery", "landmark", 38.6979, -9.2068),
      stop("Belém Tower", "landmark", 38.6916, -9.216),
      stop("Time Out Market", "restaurant", 38.7067, -9.1459),
      stop("Miradouro de Santa Luzia", "attraction", 38.7118, -9.1303),
    ],
  },
  {
    day_number: 2,
    date: "2027-01-10",
    theme: "Tiles and trams",
    activities: [
      stop("National Tile Museum", "museum", 38.7249, -9.1136),
      stop("Jardim da Estrela", "park", 38.7143, -9.1596),
      stop("Cervejaria Ramiro", "restaurant", 38.7203, -9.1356),
    ],
  },
];

const lisbon: StorySource = {
  title: "Lisbon Trip",
  trip_meta: { destination: "Lisbon, Portugal", country_code: "PT", timezone: "Europe/Lisbon" },
  start_date: "2027-01-09",
  end_date: "2027-01-10",
  itinerary: lisbonDays,
};

const clue = <K extends StoryClue["kind"]>(clues: StoryClue[], kind: K) => clues.find((c) => c.kind === kind) as Extract<StoryClue, { kind: K }>;

describe("a trip as a story", () => {
  it("names the place short, counts what the days are busy with, and measures between each day's stops", () => {
    const story = buildTripStory(lisbon, "en");
    expect(story.place).toBe("Lisbon");
    expect(story.destination).toBe("Lisbon, Portugal");
    expect(story.dayCount).toBe(2);
    expect(story.nights).toBe(1);
    // The hotel is not a stop.
    expect(story.stopCount).toBe(8);
    expect(story.km).toBeGreaterThan(5);
    expect(story.km).toBeLessThan(40);
    expect(story.route?.points.length).toBeGreaterThan(5);
    expect(story.moreDays).toBe(0);
  });

  it("tells a day by its sights first, three names, and counts the rest", () => {
    const [first, second] = buildTripStory(lisbon, "en").days;
    expect(first).toMatchObject({
      day: 1,
      date: "2027-01-09",
      title: "Alfama and the river",
      stops: ["Jerónimos Monastery", "Belém Tower", "Miradouro de Santa Luzia"],
      more: 2,
    });
    // A day with no title is told by its theme; meals come after the sights.
    expect(second).toMatchObject({ title: "Tiles and trams", stops: ["National Tile Museum", "Jardim da Estrela", "Cervejaria Ramiro"], more: 0 });
  });

  it("draws each day's own shape from its stops, the hotel left out, and none from a single pin", () => {
    const [first, second] = buildTripStory(lisbon, "en").days;
    expect(first.route?.points).toHaveLength(5);
    expect(second.route?.points).toHaveLength(3);
    expect(first.route).toMatchObject({ width: 300, height: 190, labels: [] });
    const onePin = buildTripStory({ ...lisbon, itinerary: [{ day_number: 1, activities: [stop("Sé de Lisboa", "landmark", 38.7098, -9.1326), stop("A walk", "activity")] }] }, "en");
    expect(onePin.days[0].route).toBeNull();
  });

  it("leaves the ride between two cities and a stop with no name out of a day", () => {
    const story = buildTripStory(
      {
        ...lisbon,
        itinerary: [
          {
            day_number: 1,
            activities: [
              stop("Train to Porto", "transport", 41.15, -8.61, { transport_mode: "train" }),
              stop("Ferry across the Douro", "transport", 41.14, -8.61),
              stop("", "museum"),
              stop("Livraria Lello", "landmark", 41.1469, -8.6149),
            ],
          },
        ],
      },
      "en"
    );
    expect(story.days[0].stops).toEqual(["Livraria Lello"]);
    expect(story.stopCount).toBe(1);
    expect(story.km).toBeNull();
  });

  it("gives a long trip a slide for its first days and counts the others", () => {
    const days = Array.from({ length: 10 }, (_, i) => ({ day_number: i + 1, activities: [stop(`Sight ${i + 1}`, "landmark")] }));
    const story = buildTripStory({ ...lisbon, itinerary: days, end_date: "2027-01-18" }, "en");
    expect(story.days).toHaveLength(STORY_DAY_SLIDES);
    expect(story.moreDays).toBe(10 - STORY_DAY_SLIDES);
    expect(story.dayCount).toBe(10);
  });

  it("reads a trip with no plan without failing", () => {
    const story = buildTripStory({ title: "Rome Trip", itinerary: null }, "en");
    expect(story).toMatchObject({ place: "Rome", dayCount: 0, stopCount: 0, km: null, route: null, days: [], guess: null });
  });
});

describe("the guess that opens a story", () => {
  it("gives clues taken from the trip, from far to near, none naming the place", () => {
    const { guess, place } = buildTripStory(lisbon, "en", { sunset: "17:32" });
    expect(place).toBe("Lisbon");
    expect(guess?.clues).toEqual([
      { kind: "when", days: 2, month: 1, region: "europe" },
      { kind: "sunset", time: "17:32" },
      { kind: "day", title: "Tiles and trams" },
      { kind: "stop", name: "Jerónimos Monastery" },
    ]);
    expect(JSON.stringify(guess!.clues)).not.toMatch(/lisbon|lisboa|portugal/i);
  });

  it("leaves out the sunset when it isn't known, or isn't a time", () => {
    expect(buildTripStory(lisbon, "en").guess!.clues.map((c) => c.kind)).toEqual(["when", "day", "stop"]);
    expect(buildTripStory(lisbon, "en", { sunset: "soon" }).guess!.clues.map((c) => c.kind)).toEqual(["when", "day", "stop"]);
  });

  it("never uses a day's title or a stop that gives the place away, in any of its names or by its country", () => {
    const telling = {
      ...lisbon,
      itinerary: [
        { day_number: 1, date: "2027-01-09", title: "Arrival in Lisbon", activities: [stop("Sé de Lisboa", "landmark", 38.7098, -9.1326), stop("Oceanário de Lisboa", "attraction", 38.7633, -9.0937)] },
        { day_number: 2, date: "2027-01-10", title: "The best of Portugal", activities: [stop("Lisbon Story Centre", "museum", 38.7077, -9.1365), stop("Time Out Market", "restaurant", 38.7067, -9.1459)] },
        { day_number: 3, date: "2027-01-11", title: "Hills and viewpoints", activities: [stop("Miradouro da Graça", "attraction", 38.7163, -9.1313)] },
      ],
    };
    expect(buildTripStory(telling, "en").guess!.clues).toEqual([
      { kind: "when", days: 3, month: 1, region: "europe" },
      { kind: "day", title: "Hills and viewpoints" },
      { kind: "stop", name: "Miradouro da Graça" },
    ]);
  });

  it("keeps the country of a place we have no page for out too, as its destination line writes it", () => {
    const tbilisi = {
      ...lisbon,
      trip_meta: { destination: "Tbilisi, Georgia", timezone: "Asia/Tbilisi" },
      itinerary: [
        { day_number: 1, title: "Old town", activities: [stop("National Museum of Georgia", "museum"), stop("Narikala Fortress", "landmark")] },
        { day_number: 2, title: "Wine country of Georgia", activities: [stop("Chronicle of Georgia", "landmark")] },
      ],
    };
    const clues = buildTripStory(tbilisi, "en").guess!.clues;
    expect(clue(clues, "day").title).toBe("Old town");
    expect(clue(clues, "stop").name).toBe("Narikala Fortress");
  });

  it("takes a day's title from the second day on before the first, which is often about arriving", () => {
    const days = [
      { day_number: 1, title: "Arrival and first walk", activities: [stop("Old Town Square", "landmark")] },
      { day_number: 2, title: "Castles and bridges", activities: [stop("Charles Bridge", "landmark")] },
    ];
    expect(clue(buildTripStory({ ...lisbon, trip_meta: { destination: "Prague" }, itinerary: days }, "en").guess!.clues, "day").title).toBe("Castles and bridges");
    const oneDay = [{ day_number: 1, title: "Arrival and first walk", activities: [stop("Old Town Square", "landmark")] }];
    expect(clue(buildTripStory({ ...lisbon, trip_meta: { destination: "Prague" }, itinerary: oneDay }, "en").guess!.clues, "day").title).toBe("Arrival and first walk");
  });

  it("names a sight as the last clue, never a place to eat, and never the line already used as the day's title", () => {
    const days = [
      { day_number: 1, title: "Charles Bridge", activities: [stop("Lokál", "restaurant"), stop("Charles Bridge", "landmark"), stop("Prague Castle", "landmark"), stop("Vyšehrad", "landmark")] },
    ];
    const clues = buildTripStory({ ...lisbon, trip_meta: { destination: "Prague" }, itinerary: days }, "en").guess!.clues;
    expect(clue(clues, "day").title).toBe("Charles Bridge");
    // "Prague Castle" names the place; "Charles Bridge" is the title; the restaurant is no sight.
    expect(clue(clues, "stop").name).toBe("Vyšehrad");
  });

  it("keeps a telling word of the place out, but not a word many names share", () => {
    const york = {
      ...lisbon,
      trip_meta: { destination: "New York City, United States", timezone: "America/New_York" },
      itinerary: [
        { day_number: 1, title: "A walk through the city that never sleeps", activities: [stop("York Avenue Deli", "landmark"), stop("New Museum", "museum"), stop("Central Park", "park")] },
      ],
    };
    const clues = buildTripStory(york, "en").guess!.clues;
    // "city" and "new" alone give nothing away; "York" would.
    expect(clue(clues, "day").title).toBe("A walk through the city that never sleeps");
    expect(clue(clues, "stop").name).toBe("New Museum");
  });

  it("shows a place we have a page for by its name in the reader's language", () => {
    const italianPlan = { ...lisbon, title: "Viaggio a Lisbona", trip_meta: { destination: "Lisbona, Portogallo", timezone: "Europe/Lisbon" } };
    expect(buildTripStory(italianPlan, "en").place).toBe("Lisbon");
    expect(buildTripStory(lisbon, "it").place).toBe("Lisbona");
  });

  it("keeps a place we have no page for as the plan writes it", () => {
    const story = buildTripStory({ ...lisbon, trip_meta: { destination: "São Miguel, Azores", timezone: "Atlantic/Azores" } }, "en");
    expect(story.place).toBe("São Miguel");
    expect(clue(story.guess!.clues, "when").region).toBe("atlantic");
  });

  it("names no part of the world when the trip stores no time zone, and no month without dates", () => {
    const story = buildTripStory({ ...lisbon, start_date: null, end_date: null, itinerary: lisbonDays.map(({ date: _date, ...day }) => day), trip_meta: { destination: "Lisbon" } }, "en");
    expect(clue(story.guess!.clues, "when")).toEqual({ kind: "when", days: 2, month: null, region: null });
  });

  it("still asks the guess of a plan with no titles and no sights: the letters are the game", () => {
    const story = buildTripStory({ ...lisbon, itinerary: [{ day_number: 1, activities: [stop("Time Out Market", "restaurant")] }] }, "en");
    expect(story.guess!.clues.map((c) => c.kind)).toEqual(["when"]);
  });

  it("asks no guess of a trip through several cities, and names it whole", () => {
    const story = buildTripStory(
      {
        title: "Spain Trip",
        trip_meta: { destination: "Barcelona, Madrid & Sevilla", timezone: "Europe/Madrid" },
        itinerary: [
          { day_number: 1, city: "Barcelona", activities: [stop("Sagrada Familia", "landmark", 41.4036, 2.1744)] },
          { day_number: 2, city: "Madrid", activities: [stop("Museo del Prado", "museum", 40.4138, -3.6921)] },
        ],
      },
      "en"
    );
    expect(story.guess).toBeNull();
    expect(story.place).toBe("Barcelona, Madrid & Sevilla");
    expect(story.cities).toEqual(["Barcelona", "Madrid"]);
    expect(story.route?.labels.map((l) => l.text)).toEqual(["Barcelona", "Madrid"]);
  });

  it("asks no guess when the place's name can't be spelled out on the board: too long, too short, or not a name", () => {
    for (const destination of ["San Marco Argentano and Fuscaldo di Calabria, Calabria", "3 days of food", "NY", "X-Y"]) {
      expect(buildTripStory({ ...lisbon, trip_meta: { destination } }, "en").guess).toBeNull();
    }
    expect(buildTripStory({ ...lisbon, trip_meta: { destination: "Ho Chi Minh City" } }, "en").guess).not.toBeNull();
  });

  it("compares names without accents or case", () => {
    expect(plainName("São Paulo")).toBe("sao paulo");
    expect(plainName("  Rio-de-Janeiro ")).toBe("rio de janeiro");
  });
});

/**
 * The story's own words, in each language: every sentence the screen builds must come out whole, with its
 * numbers, for one and for many.
 */
describe("the story's words", () => {
  const catalogs = { en, es, it: itMessages, pt } as const;
  for (const [locale, messages] of Object.entries(catalogs)) {
    it(`${locale}: clues, facts and counts read as sentences`, () => {
      const t = createTranslator({ locale, messages: messages as typeof en, namespace: "story" });
      const said = [
        t("guess.when", { days: 5, month: "January", where: t("guess.where.europe") }),
        t("guess.whenNoMonth", { days: 1, where: t("guess.where.atlantic") }),
        t("guess.whenNoWhere", { days: 5, month: "January" }),
        t("guess.whenBare", { days: 5 }),
        t("guess.lead", { max: 6 }),
        t("guess.misses", { count: 2, max: 6 }),
        t("guess.sunset", { time: "17:32" }),
        t("guess.dayTitle", { title: "Tiles and trams" }),
        t("guess.stop", { name: "Belém Tower" }),
        t("guess.solved", { misses: 0 }),
        t("guess.solved", { misses: 1 }),
        t("guess.solved", { misses: 4 }),
        t("guess.lost", { place: "Lisbon" }),
        t("guess.tellSolved", { misses: 0 }),
        t("guess.tellSolved", { misses: 1 }),
        t("guess.tellSolved", { misses: 3 }),
        t("guess.tellLost"),
        t("reveal.facts", { days: 5, stops: 20 }),
        t("reveal.factsKm", { days: 1, stops: 1, km: 12 }),
        t("reveal.factsCities", { days: 8, cities: 4, stops: 30 }),
        t("day.more", { count: 1 }),
        t("day.more", { count: 4 }),
        t("day.moreDays", { count: 3 }),
        t("progress", { current: 2, total: 7 }),
        t("metaTitle", { place: "Lisbon" }),
        t("mine.note"),
      ];
      for (const sentence of said) {
        expect(sentence).not.toMatch(/[{}#]|plural|undefined/);
        expect(sentence.trim().length).toBeGreaterThan(3);
      }
      expect(t("guess.when", { days: 5, month: "January", where: "X" })).toContain("5");
      expect(t("reveal.factsKm", { days: 5, stops: 20, km: 12 })).toMatch(/5.*20.*12/);
      for (const region of ["europe", "asia", "africa", "americas", "oceania", "atlantic", "indian"] as const) {
        expect(t(`guess.where.${region}`).length).toBeGreaterThan(5);
      }
    });
  }
});
