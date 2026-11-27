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

  it("lists what the plan holds, leaving out what it holds none of", () => {
    expect(storyClueText({ kind: "mix", sights: 15, meals: 6, outdoors: 1 }, t, "en")).toBe("On the plan: 15 sights, 6 food stops, and 1 stop outdoors.");
    expect(storyClueText({ kind: "mix", sights: 1, meals: 0, outdoors: 0 }, t, "en")).toBe("On the plan: 1 sight.");
    expect(storyClueText({ kind: "mix", sights: 0, meals: 2, outdoors: 3 }, t, "en")).toBe("On the plan: 2 food stops and 3 stops outdoors.");
  });

  it("gives the first letter and the length, by words for a name of several", () => {
    expect(storyClueText({ kind: "letters", first: "L", letters: 6, words: 1 }, t, "en")).toBe("It starts with L and has 6 letters.");
    expect(storyClueText({ kind: "letters", first: "S", letters: 9, words: 2 }, t, "en")).toBe("It starts with S: 2 words, 9 letters.");
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
        { kind: "letters", first: "L", letters: 6, words: 1 },
      ],
      options: ["Lisbon", "Prague", "Vienna", "Rome"],
      answer: 0,
    },
  } as unknown as TripStory;

  it("is the story's own clues, numbered, with its dates and numbers", () => {
    const words = slideWords(story, t, "en");
    expect({ ...words, dates: plain(words.dates) }).toEqual({
      guessTitle: "Guess where I'm going",
      clues: [
        { label: "Clue 1", text: "5 days in January, somewhere in Europe" },
        { label: "Clue 2", text: "It starts with L and has 6 letters." },
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
