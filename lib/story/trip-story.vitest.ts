import { describe, it, expect } from "vitest";
import { createTranslator } from "next-intl";
import { destinations } from "@/lib/destinations/data";
import en from "@/messages/en/common.json";
import es from "@/messages/es/common.json";
import itMessages from "@/messages/it/common.json";
import pt from "@/messages/pt/common.json";
import { buildTripStory, plainName, STORY_DAY_SLIDES, type StoryClue, type StorySource } from "./trip-story";

const SEED = "11111111-2222-4333-8444-555555555555";

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
    const story = buildTripStory(lisbon, "en", SEED);
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
    const [first, second] = buildTripStory(lisbon, "en", SEED).days;
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
    const [first, second] = buildTripStory(lisbon, "en", SEED).days;
    expect(first.route?.points).toHaveLength(5);
    expect(second.route?.points).toHaveLength(3);
    expect(first.route).toMatchObject({ width: 300, height: 190, labels: [] });
    const onePin = buildTripStory({ ...lisbon, itinerary: [{ day_number: 1, activities: [stop("Sé de Lisboa", "landmark", 38.7098, -9.1326), stop("A walk", "activity")] }] }, "en", SEED);
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
      "en",
      SEED
    );
    expect(story.days[0].stops).toEqual(["Livraria Lello"]);
    expect(story.stopCount).toBe(1);
    expect(story.km).toBeNull();
  });

  it("gives a long trip a slide for its first days and counts the others", () => {
    const days = Array.from({ length: 10 }, (_, i) => ({ day_number: i + 1, activities: [stop(`Sight ${i + 1}`, "landmark")] }));
    const story = buildTripStory({ ...lisbon, itinerary: days, end_date: "2027-01-18" }, "en", SEED);
    expect(story.days).toHaveLength(STORY_DAY_SLIDES);
    expect(story.moreDays).toBe(10 - STORY_DAY_SLIDES);
    expect(story.dayCount).toBe(10);
  });

  it("reads a trip with no plan without failing", () => {
    const story = buildTripStory({ title: "Rome Trip", itinerary: null }, "en", SEED);
    expect(story).toMatchObject({ place: "Rome", dayCount: 0, stopCount: 0, km: null, route: null, days: [], guess: null });
  });
});

describe("the guess that opens a story", () => {
  it("gives three clues, from far to near, none naming the place", () => {
    const { guess } = buildTripStory(lisbon, "en", SEED);
    expect(guess?.clues.map((c) => c.kind)).toEqual(["when", "mix", "letters"]);
    expect(clue(guess!.clues, "when")).toEqual({ kind: "when", days: 2, month: 1, region: "europe" });
    // Meals are 3, the park is outdoors, the other four are sights.
    expect(clue(guess!.clues, "mix")).toEqual({ kind: "mix", sights: 4, meals: 3, outdoors: 1 });
    expect(clue(guess!.clues, "letters")).toEqual({ kind: "letters", first: "L", letters: 6, words: 1 });
    expect(JSON.stringify(guess!.clues)).not.toMatch(/lisbon|portugal/i);
  });

  it("offers four places, the trip's once, with wrong answers from the same part of the world", () => {
    const { guess } = buildTripStory(lisbon, "en", SEED);
    expect(guess!.options).toHaveLength(4);
    expect(new Set(guess!.options).size).toBe(4);
    expect(guess!.options[guess!.answer]).toBe("Lisbon");
    const european = new Set(destinations.filter((d) => d.continent === "europe").map((d) => d.name.en));
    for (const option of guess!.options) expect(european.has(option)).toBe(true);
  });

  it("shows everyone who opens one link the same four in the same order, and another link another draw", () => {
    const again = buildTripStory(lisbon, "en", SEED).guess!;
    expect(buildTripStory(lisbon, "en", SEED).guess).toEqual(again);
    const draws = new Set(
      ["a", "b", "c", "d", "e", "f", "g", "h"].map((seed) => JSON.stringify(buildTripStory(lisbon, "en", seed).guess!.options))
    );
    expect(draws.size).toBeGreaterThan(1);
  });

  it("shows a place we have a page for by its name in the reader's language", () => {
    const italianPlan = { ...lisbon, title: "Viaggio a Lisbona", trip_meta: { destination: "Lisbona, Portogallo", timezone: "Europe/Lisbon" } };
    const english = buildTripStory(italianPlan, "en", SEED);
    expect(english.place).toBe("Lisbon");
    expect(english.guess!.options[english.guess!.answer]).toBe("Lisbon");
    const italian = buildTripStory(lisbon, "it", SEED);
    expect(italian.place).toBe("Lisbona");
    expect(clue(italian.guess!.clues, "letters")).toMatchObject({ first: "L", letters: 7 });
    // Its wrong answers are in Italian too.
    expect(italian.guess!.options).not.toContain("London");
  });

  it("keeps a place we have no page for as the plan writes it, and counts its letters past spaces", () => {
    const story = buildTripStory({ ...lisbon, trip_meta: { destination: "São Miguel, Azores", timezone: "Atlantic/Azores" } }, "en", SEED);
    expect(story.place).toBe("São Miguel");
    expect(clue(story.guess!.clues, "when").region).toBe("atlantic");
    expect(clue(story.guess!.clues, "letters")).toEqual({ kind: "letters", first: "S", letters: 9, words: 2 });
    expect(story.guess!.options).toContain("São Miguel");
  });

  it("never offers a city of the trip's own country as a wrong answer, when the place may be the country itself", () => {
    const japan = { ...lisbon, trip_meta: { destination: "Japan", country_code: "jp", timezone: "Asia/Tokyo" } };
    const seeds = Array.from({ length: 40 }, (_, i) => `seed-${i}`);
    const offered = new Set(seeds.flatMap((seed) => buildTripStory(japan, "en", seed).guess!.options));
    expect(offered.has("Japan")).toBe(true);
    expect(offered.has("Tokyo")).toBe(false);
    // The same seeds do offer Tokyo for a trip elsewhere in Asia: it is left out for Japan, not missing.
    const korea = { ...lisbon, trip_meta: { destination: "Jeju", country_code: "KR", timezone: "Asia/Seoul" } };
    expect(seeds.some((seed) => buildTripStory(korea, "en", seed).guess!.options.includes("Tokyo"))).toBe(true);
  });

  it("still offers another city of the same country against a city we know", () => {
    const pool = destinations.filter((d) => d.countryCode === destinations.find((x) => x.name.en === "Barcelona")!.countryCode && d.name.en !== "Barcelona");
    expect(pool.length).toBeGreaterThan(0);
    const barcelona = { ...lisbon, trip_meta: { destination: "Barcelona, Spain", country_code: "ES", timezone: "Europe/Madrid" } };
    const seeds = Array.from({ length: 60 }, (_, i) => `seed-${i}`);
    expect(seeds.some((seed) => buildTripStory(barcelona, "en", seed).guess!.options.some((option) => pool.some((d) => d.name.en === option)))).toBe(true);
  });

  it("names no part of the world when the trip stores no time zone, and no month without dates", () => {
    const story = buildTripStory({ ...lisbon, start_date: null, end_date: null, itinerary: lisbonDays.map(({ date: _date, ...day }) => day), trip_meta: { destination: "Lisbon" } }, "en", SEED);
    expect(clue(story.guess!.clues, "when")).toEqual({ kind: "when", days: 2, month: null, region: null });
  });

  it("skips the plan's mix when the days hold no stops", () => {
    const story = buildTripStory({ ...lisbon, itinerary: [{ day_number: 1, activities: [] }] }, "en", SEED);
    expect(story.guess!.clues.map((c) => c.kind)).toEqual(["when", "letters"]);
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
      "en",
      SEED
    );
    expect(story.guess).toBeNull();
    expect(story.place).toBe("Barcelona, Madrid & Sevilla");
    expect(story.cities).toEqual(["Barcelona", "Madrid"]);
    expect(story.route?.labels.map((l) => l.text)).toEqual(["Barcelona", "Madrid"]);
  });

  it("asks no guess when the place's name is no answer to pick: too long, or not a name", () => {
    for (const destination of ["San Marco Argentano and Fuscaldo, Calabria", "3 days of food", "NY"]) {
      expect(buildTripStory({ ...lisbon, trip_meta: { destination } }, "en", SEED).guess).toBeNull();
    }
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
        t("guess.mix", { list: [t("guess.sights", { count: 4 }), t("guess.meals", { count: 1 }), t("guess.outdoors", { count: 2 })].join(", ") }),
        t("guess.letters", { first: "L", letters: 6 }),
        t("guess.lettersWords", { first: "S", words: 2, letters: 9 }),
        t("guess.right", { clues: 1 }),
        t("guess.right", { clues: 3 }),
        t("guess.wrong", { place: "Lisbon" }),
        t("reveal.facts", { days: 5, stops: 20 }),
        t("reveal.factsKm", { days: 1, stops: 1, km: 12 }),
        t("reveal.factsCities", { days: 8, cities: 4, stops: 30 }),
        t("day.more", { count: 1 }),
        t("day.more", { count: 4 }),
        t("day.moreDays", { count: 3 }),
        t("progress", { current: 2, total: 7 }),
        t("metaTitle", { place: "Lisbon" }),
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
