/**
 * The dates a traveller gives for the whole trip, read from a message: "28 nov
 * we arrive ... and go back 8 dec", "del 28 de noviembre al 8 de diciembre",
 * "dal 28 novembre all'8 dicembre", "28/11 - 8/12". The trip page's assistant
 * can't move a trip's dates itself, so what is read here goes to Change dates.
 *
 * English, Spanish, Italian and Portuguese. Two dates are the trip's first and
 * last day. One date is the last day when a word before it says so ("until",
 * "go back", "hasta", "fino al", "até"); anything else, or three dates, is not a
 * trip's span. Each date takes the year that puts it nearest the trip, and a
 * last day before the first moves on a year.
 */

import { resolveAiLanguage } from "@/lib/ai/language";
import { formatDateRange } from "@/lib/datetime";
import { note } from "./notes";
import type { AssistantMessage } from "./thread";

export interface TripDates {
  /** The first day, as YYYY-MM-DD. */
  start: string;
  /** The last day, as YYYY-MM-DD. */
  end: string;
}

/** Longer than any trip the planner makes: a span past it is a misreading. */
const MAX_SPAN_DAYS = 60;

const MONTHS = new Map<string, number>();
const add = (month: number, ...names: string[]) => names.forEach((name) => MONTHS.set(name, month));
add(1, "january", "jan", "enero", "ene", "gennaio", "gen", "janeiro");
add(2, "february", "feb", "febrero", "febbraio", "fevereiro", "fev");
add(3, "march", "mar", "marzo", "marco");
add(4, "april", "apr", "abril", "abr", "aprile");
add(5, "may", "mayo", "maggio", "mag", "maio", "mai");
add(6, "june", "jun", "junio", "giugno", "giu", "junho");
add(7, "july", "jul", "julio", "luglio", "lug", "julho");
add(8, "august", "aug", "agosto", "ago");
add(9, "september", "sep", "sept", "septiembre", "setiembre", "set", "settembre", "setembro");
add(10, "october", "oct", "octubre", "ottobre", "ott", "outubro", "out");
add(11, "november", "nov", "noviembre", "novembre", "novembro");
add(12, "december", "dec", "diciembre", "dic", "dicembre", "dezembro", "dez");

/** Month words that are also everyday words: after "day 3", "may" is a verb, not May. */
const AMBIGUOUS = new Set(["may", "mar", "set", "out", "ago", "gen", "mai"]);

/** A number with one of these after it is a time, a length or a price, not a date. */
const UNIT = String.raw`(?!\s*(?:h|hr|hrs|hours?|ore|ora|horas?|min|mins|minutes?|minuti|minutos|km|mi|miles|kg|am|pm|eur|euros?|usd|\$|€|%|:))`;

/** Words before a lone date that make it the trip's last day. */
const LAST_DAY = /(?:until|till|through|thru|back|home|hasta|volvemos|regresamos|fino a(?:l|ll)?|torniamo|ripartiamo|ate|voltamos)\s+(?:the\s+|el\s+|il\s+|o\s+|dia\s+|day\s+)?$/;

interface Found {
  at: number;
  to: number;
  day: number;
  month: number;
  year?: number;
}

interface Numeric {
  at: number;
  to: number;
  a: number;
  b: number;
  year?: number;
}

/** Lower case, without accents or apostrophes: "All'8 Dicembre" reads "all 8 dicembre". */
function plain(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, " ");
}

function fullYear(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  return raw.length === 2 ? 2000 + n : n;
}

/** The dates in the message, in the order they come, before years are given to them. */
function findDates(text: string): Found[] {
  const found: Found[] = [];
  const named = new RegExp(String.raw`(?<![\d/.-])(\d{1,2})(?:st|nd|rd|th|o|a)?\s*(?:de\s+|of\s+)?([a-z]{3,10})\b`, "g");
  for (const m of text.matchAll(named)) {
    const month = MONTHS.get(m[2]);
    if (!month) continue;
    if (AMBIGUOUS.has(m[2]) && /\b(?:day|dia|giorno)\s*$/.test(text.slice(0, m.index))) continue;
    found.push({ at: m.index!, to: m.index! + m[0].length, day: Number(m[1]), month });
  }
  const monthFirst = new RegExp(String.raw`\b([a-z]{3,10})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b${UNIT}`, "g");
  for (const m of text.matchAll(monthFirst)) {
    const month = MONTHS.get(m[1]);
    if (!month || AMBIGUOUS.has(m[1])) continue;
    found.push({ at: m.index!, to: m.index! + m[0].length, day: Number(m[2]), month });
  }

  // Numbers: "28/11", "11/28", "28-11-2026", "28.11.2026" (dots only with a year: "10.30" is a time).
  const numeric: Numeric[] = [];
  const slashes = new RegExp(String.raw`(?<![\d/.-])(\d{1,2})([/-])(\d{1,2})(?:\2(\d{4}|\d{2}))?(?![\d/.-])${UNIT}`, "g");
  for (const m of text.matchAll(slashes)) {
    numeric.push({ at: m.index!, to: m.index! + m[0].length, a: Number(m[1]), b: Number(m[3]), year: fullYear(m[4]) });
  }
  const dots = /(?<![\d/.-])(\d{1,2})\.(\d{1,2})\.(\d{4})(?![\d/.-])/g;
  for (const m of text.matchAll(dots)) {
    numeric.push({ at: m.index!, to: m.index! + m[0].length, a: Number(m[1]), b: Number(m[2]), year: fullYear(m[3]) });
  }
  // One order for the whole message: day first unless a number shows it is month first.
  const monthFirstNumbers = !numeric.some((n) => n.a > 12) && numeric.some((n) => n.b > 12);
  for (const n of numeric) {
    const [day, month] = monthFirstNumbers ? [n.b, n.a] : [n.a, n.b];
    if (month >= 1 && month <= 12) found.push({ at: n.at, to: n.to, day, month, year: n.year });
  }

  // In order, and a stretch read twice counts once.
  found.sort((x, y) => x.at - y.at);
  const kept: Found[] = [];
  for (const f of found) {
    const last = kept[kept.length - 1];
    if (!last || f.at >= last.to) kept.push(f);
  }
  return kept;
}

const DAY_MS = 86_400_000;
const utc = (year: number, month: number, day: number) => Date.UTC(year, month - 1, day);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const isRealDate = (year: number, month: number, day: number) => new Date(utc(year, month, day)).getUTCDate() === day;

/** The date with its year: the one given, or the one nearest the trip's start. */
function dated(f: Found, tripStart: number): number | null {
  if (f.year !== undefined) return isRealDate(f.year, f.month, f.day) ? utc(f.year, f.month, f.day) : null;
  const year = new Date(tripStart).getUTCFullYear();
  const options = [year - 1, year, year + 1]
    .filter((y) => isRealDate(y, f.month, f.day))
    .map((y) => utc(y, f.month, f.day))
    .sort((p, q) => Math.abs(p - tripStart) - Math.abs(q - tripStart));
  return options[0] ?? null;
}

const nextYear = (ms: number) => {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear() + 1, d.getUTCMonth(), d.getUTCDate());
};

/**
 * The span the message gives for the trip, or null when it gives none. `trip`
 * is the trip as it stands; its start dates a lone last day and picks the years.
 */
export function readTripDates(message: string, trip: { startDate: string }): TripDates | null {
  const tripStart = Date.parse(`${trip.startDate}T00:00:00Z`);
  if (Number.isNaN(tripStart)) return null;
  const text = plain(message);
  const found = findDates(text);

  let start: number | null;
  let end: number | null;
  if (found.length === 2) {
    start = dated(found[0], tripStart);
    end = dated(found[1], tripStart);
    if (start === null || end === null) return null;
    if (end < start && found[1].year === undefined) end = nextYear(end);
  } else if (found.length === 1 && LAST_DAY.test(text.slice(0, found[0].at))) {
    start = tripStart;
    end = dated(found[0], tripStart);
    if (end === null) return null;
  } else {
    return null;
  }

  const days = Math.round((end - start) / DAY_MS) + 1;
  if (days < 1 || days > MAX_SPAN_DAYS) return null;
  return { start: iso(start), end: iso(end) };
}

/**
 * Words that make two dates the trip's own: arriving, landing, flying, going
 * back or home, leaving, staying until, the dates. Without one, "the Louvre on
 * 1 dec and the Orsay on 3 dec" is two days of the trip, not new dates for it.
 * Read on plain text, so without accents ("até" is "ate").
 */
const DATES_CUE = new RegExp(
  `\\b(?:${[
    // English
    "dates?", "arriv\\w*", "land(?:s|ed|ing)?", "fly(?:ing)?", "flights?", "return\\w*", "back", "home",
    "leav(?:e|es|ing)", "depart\\w*", "stay(?:s|ed|ing)?", "until", "till", "extend\\w*",
    // Spanish
    "fechas?", "lleg\\w*", "aterriz\\w*", "vuelos?", "volv\\w*", "vuelta", "regres\\w*", "salimos", "salida",
    "quedamos", "quedarnos", "hasta",
    // Italian
    "data", "atterr\\w*", "vol[io]", "partiamo", "partenza", "ripartiamo", "torniamo", "tornare", "ritorno",
    "rientro", "restiamo", "rimaniamo", "fino",
    // Portuguese
    "datas", "cheg\\w*", "pous\\w*", "voos?", "volt\\w*", "partimos", "partida", "saimos", "saida", "ficamos", "ate",
  ].join("|")})\\b`,
);

/** A span this many days shorter than the trip, or more, is some of its days, not new dates for it. */
const SHORTER_BY_MORE_THAN = 3;

const spanDays = (span: TripDates) =>
  Math.round((Date.parse(`${span.end}T00:00:00Z`) - Date.parse(`${span.start}T00:00:00Z`)) / DAY_MS) + 1;

/**
 * The new dates an ask gives for the whole trip, or null. The ask, or the one
 * before it ("can you change our dates?", then "28 nov - 8 dec"), is about
 * arriving, leaving or the dates; the span differs from the trip's and is about
 * as long or longer.
 */
export function askedTripDates(message: string, previousAsk: string | undefined, trip: TripDates): TripDates | null {
  if (!DATES_CUE.test(plain(message)) && !(previousAsk && DATES_CUE.test(plain(previousAsk)))) return null;
  const asked = readTripDates(message, { startDate: trip.start });
  if (!asked || (asked.start === trip.start && asked.end === trip.end)) return null;
  if (spanDays(asked) < spanDays(trip) - SHORTER_BY_MORE_THAN) return null;
  return asked;
}

/**
 * The reply with Change dates offered under it, on the asked dates. The chat
 * can't move a trip, so the reply says its dates stand until the button.
 */
export function offerTripDates(
  reply: AssistantMessage,
  asked: TripDates | null,
  trip: TripDates | null,
  language: string | undefined,
): AssistantMessage {
  if (!asked || !trip) return reply;
  const locale = resolveAiLanguage(language);
  const offer = note(locale, "tripDatesOffer", {
    current: formatDateRange(trip.start, trip.end, locale),
    range: formatDateRange(asked.start, asked.end, locale),
  });
  return { ...reply, content: `${reply.content}\n\n${offer}`, changeDates: asked };
}
