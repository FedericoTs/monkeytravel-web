import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";
import en from "@/messages/en/common.json";
import itMessages from "@/messages/it/common.json";
import type { TripStory } from "./trip-story";
import { slideWords, storyClueText, storyDate, storyDates, storyFacts, type StoryTranslator } from "./words";

/**
 * The story's sentences as a reader gets them: the same ones on the screen a friend taps through and on the
 * pictures made to post.
 */

const t = createTranslator({ locale: "en", messages: en, namespace: "story" }) as unknown as StoryTranslator;
const tIt = createTranslator({ locale: "it", messages: itMessages as typeof en, namespace: "story" }) as unknown as StoryTranslator;

describe("a clue", () => {
  it("says how long, when and in which part of the world, with what it knows", () => {
    expect(storyClueText({ kind: "when", days: 5, month: 1, region: "europe" }, t, "en")).toBe("5 days in January, somewhere in Europe");
    expect(storyClueText({ kind: "when", days: 1, month: null, region: "atlantic" }, t, "en")).toBe("One day, on an island in the Atlantic");
    expect(storyClueText({ kind: "when", days: 3, month: 12, region: null }, t, "en")).toBe("3 days in December");
    expect(storyClueText({ kind: "when", days: 3, month: null, region: null }, t, "en")).toBe("A trip of 3 days");
  });

  it("names the month in the reader's language", () => {
    expect(storyClueText({ kind: "when", days: 8, month: 1, region: "europe" }, tIt, "it")).toBe("8 giorni a gennaio, da qualche parte in Europa");
  });

  it("tells the first evening's sunset, a day by its title and a stop by its name", () => {
    expect(storyClueText({ kind: "sunset", time: "17:32" }, t, "en")).toBe("On the first evening the sun sets at 17:32.");
    expect(storyClueText({ kind: "day", title: "Tiles and trams" }, t, "en")).toBe("One of its days is called “Tiles and trams”.");
    expect(storyClueText({ kind: "stop", name: "Belém Tower" }, t, "en")).toBe("One stop on the plan: Belém Tower.");
    expect(storyClueText({ kind: "day", title: "Azulejos e bondes" }, tIt, "it")).toBe("Uno dei suoi giorni si chiama «Azulejos e bondes».");
  });
});

describe("the trip's numbers", () => {
  it("count its cities when it has several, else the distance between a day's stops when there is one", () => {
    expect(storyFacts({ dayCount: 8, stopCount: 30, km: 12, cities: ["Rome", "Florence", "Venice"] }, t)).toBe("8 days, 3 cities and 30 stops.");
    expect(storyFacts({ dayCount: 5, stopCount: 22, km: 26, cities: [] }, t)).toBe("5 days and 22 stops, about 26 km between them.");
    expect(storyFacts({ dayCount: 1, stopCount: 1, km: null, cities: ["Rome"] }, t)).toBe("One day and 1 stop.");
  });
});

// A range is set with thin spaces around its dash: the tests read it with plain ones.
const plain = (text: string | null) => text?.replace(/\s+/g, " ") ?? null;

describe("the trip's dates", () => {
  it("are a range in the reader's language, a single day for a day trip, and nothing without a start", () => {
    expect(plain(storyDates("2027-01-09", "2027-01-13", "en"))).toBe("January 9 – 13, 2027");
    expect(plain(storyDates("2027-01-09", "2027-01-13", "it"))).toBe("09–13 gennaio 2027");
    expect(storyDates("2027-01-09", "2027-01-09", "en")).toBe("January 9, 2027");
    expect(storyDates("2027-01-09", null, "en")).toBe("January 9, 2027");
    expect(storyDates(null, "2027-01-13", "en")).toBeNull();
  });

  it("read a day from the start of a timestamp, and nothing from what is no date", () => {
    expect(storyDate("2027-01-09T23:30:00+09:00")?.toISOString()).toBe("2027-01-09T00:00:00.000Z");
    expect(storyDate("next week")).toBeNull();
    expect(storyDate("2027-13-45")).toBeNull();
    expect(storyDate(null)).toBeNull();
  });
});

describe("what the pictures to post say", () => {
  const story = {
    place: "Lisbon",
    startDate: "2027-01-09",
    endDate: "2027-01-13",
    dayCount: 5,
    stopCount: 22,
    km: 26,
    cities: [],
    guess: {
      clues: [
        { kind: "when", days: 5, month: 1, region: "europe" },
        { kind: "sunset", time: "17:32" },
        { kind: "day", title: "Tiles and trams" },
        { kind: "stop", name: "Belém Tower" },
      ],
    },
  } as unknown as TripStory;

  it("is the story's clues, numbered, without the stop the game keeps for last, with its dates and numbers", () => {
    const words = slideWords(story, t, "en");
    expect({ ...words, dates: plain(words.dates) }).toEqual({
      place: "Lisbon",
      guessTitle: "Guess where I'm going",
      clues: [
        { label: "Clue 1", text: "5 days in January, somewhere in Europe" },
        { label: "Clue 2", text: "On the first evening the sun sets at 17:32." },
        { label: "Clue 3", text: "One of its days is called “Tiles and trams”." },
      ],
      reply: "Send me your guess",
      dates: "January 9 – 13, 2027",
      facts: "5 days and 22 stops, about 26 km between them.",
      planYours: "Plan yours free at monkeytravel.app",
    });
  });

  it("has no clues for a story that asks no guess", () => {
    expect(slideWords({ ...story, guess: null }, t, "en").clues).toEqual([]);
  });
});
