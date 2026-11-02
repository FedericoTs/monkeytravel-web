/**
 * Which days of the trip a message names: "day 5", "día 3", "giorno 4".
 */

// "day 5", "Day 12", "día 3", "dia 3", "giorno 4" (not "days 5-6").
const DAY_RE = /(?<![\p{L}])(?:day|d[ií]a|giorno)\s*(\d{1,2})(?![\p{N}])/iu;

/** The first "day N" in the message, if any. */
export function dayMentioned(message: string): number | undefined {
  const m = DAY_RE.exec(message);
  if (!m) return undefined;
  const n = parseInt(m[1], 10);
  return n >= 1 ? n : undefined;
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
