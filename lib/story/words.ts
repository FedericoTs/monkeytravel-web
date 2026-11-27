/**
 * The story's sentences, built once for the screen a friend taps through and for the images made to post:
 * a clue, the trip's numbers, its dates. `t` is the story's translator ("common.story"), on the server or in
 * the browser.
 */
import type { SlideWords } from "@/lib/og/story-slides";
import type { StoryClue, TripStory } from "./trip-story";

export type StoryTranslator = (key: string, values?: Record<string, string | number>) => string;

export function storyDate(iso: string | null): Date | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "January 9 – 13, 2027", in the reader's language. */
export function storyDates(start: string | null, end: string | null, locale: string): string | null {
  const from = storyDate(start);
  const to = storyDate(end);
  if (!from) return null;
  const format = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  return to && to.getTime() !== from.getTime() ? format.formatRange(from, to) : format.format(from);
}

export function storyClueText(clue: StoryClue, t: StoryTranslator, locale: string): string {
  if (clue.kind === "sunset") return t("guess.sunset", { time: clue.time });
  if (clue.kind === "day") return t("guess.dayTitle", { title: clue.title });
  if (clue.kind === "stop") return t("guess.stop", { name: clue.name });
  const month = clue.month
    ? new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2024, clue.month - 1, 1)))
    : null;
  const where = clue.region ? t(`guess.where.${clue.region}`) : null;
  if (month && where) return t("guess.when", { days: clue.days, month, where });
  if (where) return t("guess.whenNoMonth", { days: clue.days, where });
  if (month) return t("guess.whenNoWhere", { days: clue.days, month });
  return t("guess.whenBare", { days: clue.days });
}

/** The trip in one sentence: its days and stops, with its cities when it has several, or the distance between a day's stops. */
export function storyFacts(story: Pick<TripStory, "dayCount" | "stopCount" | "km" | "cities">, t: StoryTranslator): string {
  if (story.cities.length > 1) return t("reveal.factsCities", { days: story.dayCount, cities: story.cities.length, stops: story.stopCount });
  if (story.km) return t("reveal.factsKm", { days: story.dayCount, stops: story.stopCount, km: story.km });
  return t("reveal.facts", { days: story.dayCount, stops: story.stopCount });
}

/** What the pictures made to post say (lib/og/story-slides.tsx): the same clues and numbers as the story's screen. */
export function slideWords(story: TripStory, t: StoryTranslator, locale: string): SlideWords {
  return {
    place: story.place,
    guessTitle: t("post.guessTitle"),
    // The picture keeps the plan's own stop back: it is the last clue of the game the link opens.
    clues: (story.guess?.clues ?? [])
      .filter((clue) => clue.kind !== "stop")
      .map((clue, i) => ({ label: t("guess.clue", { number: i + 1 }), text: storyClueText(clue, t, locale) })),
    reply: t("post.reply"),
    dates: storyDates(story.startDate, story.endDate, locale),
    facts: storyFacts(story, t),
    planYours: t("post.planYours"),
  };
}
