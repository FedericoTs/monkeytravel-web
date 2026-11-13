/**
 * Which days of the trip a message names: "day 5", "día 3", "giorno 4".
 */

// Month names in en/es/it/pt. English "may" is left out: "day 3 may be long" names a day.
const MONTH = [
  "january|february|march|april|june|july|august|september|october|november|december",
  "enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre",
  "gennaio|febbraio|aprile|maggio|giugno|luglio|settembre|ottobre|novembre|dicembre",
  "janeiro|fevereiro|mar[cç]o|maio|junho|julho|setembro|outubro|novembro|dezembro",
].join("|");

// A day of the month is not a day of the trip: "dia 19/12", "día 3.1",
// "dia 19 de dezembro", "giorno 5 maggio".
const NOT_A_DATE = `(?![\\p{N}])(?![/.]\\d)(?!\\s+(?:de\\s+|of\\s+)?(?:${MONTH})(?![\\p{L}]))`;

// "day 5", "Day 12", "día 3", "dia 3", "giorno 4" (not "days 5-6").
const DAY = `(?<![\\p{L}])(?:day|d[ií]a|giorno)\\s*(\\d{1,2})${NOT_A_DATE}`;
const DAY_RE = new RegExp(DAY, "iu");

/** The first "day N" in the message, if any. */
export function dayMentioned(message: string): number | undefined {
  const m = DAY_RE.exec(message);
  if (!m) return undefined;
  const n = parseInt(m[1], 10);
  return n >= 1 ? n : undefined;
}

const DAY_RE_ALL = new RegExp(DAY, "giu");

/** Every day number a text mentions, in order, without repeats. */
export function daysMentioned(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(DAY_RE_ALL)) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && !out.includes(n)) out.push(n);
  }
  return out;
}
