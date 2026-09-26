/**
 * Which day of the trip an edit request is about.
 *
 * WHY (2026-09-26)
 * The trip assistant's action parser only read a day from one phrasing, "add
 * X to day N", and the add handler fell back to Day 1 whenever it found none.
 * So "I need to get rid of day 5 info and add the part where we go to
 * Civitavecchia port" added the port stop to Day 1. And "Can we delete it day
 * 5" searched the whole trip for an activity called "it day 5", which the
 * fuzzy matcher found on Day 6 ("Cruise Day: Enjoy Ship Amenities") through
 * the word "day". Both happened, in one session, to a user who then deleted
 * the trip.
 *
 * withDayTarget reads the day from anywhere in the message, takes "day N" out
 * of the activity name, and drops a name that is only a pronoun ("it") so the
 * matcher is never handed nothing to go on. The handlers then search only the
 * named day, and ask which day rather than guessing.
 */

// "day 5", "Day 12", "día 3", "dia 3", "giorno 4" (not "days 5-6").
const DAY_RE = /(?<![\p{L}])(?:day|d[ií]a|giorno)\s*(\d{1,2})(?![\p{N}])/iu;
const DAY_PHRASE_RE =
  /\s*(?:(?:on|from|for|in|of|to)\s+)?(?:the\s+)?(?<![\p{L}])(?:day|d[ií]a|giorno)\s*\d{1,2}(?![\p{N}])(?:['’]s)?/giu;

/** Words that point back at something rather than name it. */
const NOT_A_NAME = new Set([
  "it", "this", "that", "them", "those", "these", "one", "ones", "everything", "all", "stuff", "info",
  "something", "activity", "activities", "thing", "things", "plan", "plans",
]);

/** The first "day N" in the message, if any. */
export function dayMentioned(message: string): number | undefined {
  const m = DAY_RE.exec(message);
  if (!m) return undefined;
  const n = parseInt(m[1], 10);
  return n >= 1 ? n : undefined;
}

/** The activity name with "on day N" / "day N" taken out. */
export function stripDayMention(name: string): string {
  return name.replace(DAY_PHRASE_RE, " ").replace(/\s{2,}/g, " ").trim();
}

/** Something the fuzzy matcher can use: at least 3 letters, not a pronoun. */
export function isUsableActivityName(name: string | undefined): name is string {
  if (!name) return false;
  const words = name.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  const meaningful = words.filter((w) => !NOT_A_NAME.has(w) && w !== "the" && w !== "a" && w !== "an");
  return meaningful.join("").length >= 3;
}

/** The intent with its day filled in from the message and its name cleaned. */
export function withDayTarget<T extends { activityName?: string; dayNumber?: number }>(
  intent: T,
  message: string
): T {
  const dayNumber = intent.dayNumber ?? dayMentioned(message);
  const cleaned = intent.activityName === undefined ? undefined : stripDayMention(intent.activityName);
  return {
    ...intent,
    dayNumber,
    activityName: isUsableActivityName(cleaned) ? cleaned : undefined,
  };
}

const DAY_RE_ALL = /(?<![\p{L}])(?:day|d[ií]a|giorno)\s*(\d{1,2})(?![\p{N}])/giu;

/** Every day number a text mentions, in order, without repeats. */
export function daysMentioned(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(DAY_RE_ALL)) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && !out.includes(n)) out.push(n);
  }
  return out;
}
