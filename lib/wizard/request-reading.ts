import { TRIP_VIBES, type TripVibe } from "@/types";
import { addIsoDays, isValidIsoDate, tripSpanDays } from "@/lib/dates/iso-date";
import { MAX_CITIES, joinCities } from "@/lib/ai/multi-city-core";
import {
  DESTINATION_ALLOWLIST,
  DESTINATION_MAX_LENGTH,
  MAX_TRIP_DAYS,
  MAX_TRIP_DAYS_MULTI,
  ROUTE_STOP_NIGHTS_MAX,
  VIBES_MAX,
} from "@/lib/trips/request-limits";
import { pencilledDates } from "@/lib/wizard/trip-sentence";
import type { ChosenTripIntent } from "./answers";

/**
 * A request typed into the destination box ("18 days in Vietnam in August,
 * family of four"), as the reader read it: the places in the order of the
 * trip with the days the request gives each, the dates or the month, who's
 * going, and the vibes and budget it names. Nothing here is guessed.
 */
export interface RequestReading {
  places: Array<{ name: string; days: number | null }>;
  /** The whole trip's length, when the request says it. */
  days: number | null;
  startDate: string | null;
  endDate: string | null;
  month: number | null;
  who: "solo" | "couple" | "family" | "friends" | null;
  vibes: TripVibe[];
  budget: "budget" | "luxury" | null;
}

/** The reader's answer as it arrives: every field is checked by readingOf. */
export interface ReadingAnswer {
  places?: Array<{ name?: unknown; days?: unknown }>;
  days?: unknown;
  start_date?: unknown;
  end_date?: unknown;
  month?: unknown;
  who?: unknown;
  vibes?: unknown;
  budget?: unknown;
}

/** A place's name longer than this is a sentence the reader passed on. */
const PLACE_NAME_MAX = 60;
/** More days than this is no trip length. */
const DAYS_MAX = 60;
const WHO = ["solo", "couple", "family", "friends"] as const;

const wholeDays = (v: unknown) => (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= DAYS_MAX ? (v as number) : null);
const isoDate = (v: unknown) => (typeof v === "string" && isValidIsoDate(v.trim()) ? v.trim() : null);
const oneOf = <T extends string>(v: unknown, values: readonly T[]) => (values.includes(v as T) ? (v as T) : null);

/**
 * What the answer says, checked: places that can be destinations, dates no
 * earlier than today and in order, the canonical vibes only.
 */
export function readingOf(answer: ReadingAnswer, today: string): RequestReading {
  const places = (Array.isArray(answer.places) ? answer.places : [])
    .map((p) => ({ name: typeof p?.name === "string" ? p.name.trim() : "", days: wholeDays(p?.days) }))
    .filter((p) => p.name.length >= 2 && p.name.length <= PLACE_NAME_MAX && DESTINATION_ALLOWLIST.test(p.name));
  const start = isoDate(answer.start_date);
  const end = isoDate(answer.end_date);
  const startsOk = start !== null && start >= today;
  const vibes = Array.isArray(answer.vibes) ? answer.vibes.filter((v): v is TripVibe => TRIP_VIBES.includes(v as TripVibe)) : [];
  const month = Number.isInteger(answer.month) && (answer.month as number) >= 1 && (answer.month as number) <= 12 ? (answer.month as number) : null;
  return {
    places,
    days: wholeDays(answer.days),
    startDate: startsOk ? start : null,
    endDate: startsOk && end !== null && end >= start ? end : null,
    month,
    who: oneOf(answer.who, WHO),
    vibes: [...new Set(vibes)].slice(0, VIBES_MAX),
    budget: oneOf(answer.budget, ["budget", "luxury"] as const),
  };
}

/** What a reading fills in on step 1. */
export interface RequestFill {
  /** The place, or the places joined: the route's label when there is a route; "" when it names none. */
  destination: string;
  /** With multi-city on and several places: the route builder's rows. */
  route: Array<{ city: string; nights: number }> | null;
  /** "" when the request names no place and gives no time: the dates stay as they are. */
  startDate: string;
  endDate: string;
  /** The dates are the traveller's own (picked, or in the request), not pencilled in. */
  datesSaid: boolean;
  /** The request asked for more days than a trip may have: the trip has this many. */
  capped: number | null;
  intent: ChosenTripIntent | null;
  vibes: TripVibe[];
  budget: "budget" | "luxury" | null;
}

const total = (rows: Array<{ nights: number }>) => rows.reduce((sum, r) => sum + r.nights, 0);

/**
 * The route's rows for `length` days: each place's own days, the rest shared
 * among the places the request gives none; then fitted to the length, taking
 * from the longest stay and giving to the last.
 */
function routeRows(places: RequestReading["places"], length: number): Array<{ city: string; nights: number }> {
  const given = places.reduce((sum, p) => sum + (p.days ?? 0), 0);
  const missing = places.filter((p) => p.days === null).length;
  const share = missing > 0 ? Math.max(1, Math.floor((length - given) / missing)) : 0;
  const rows = places.map((p) => ({ city: p.name, nights: Math.min(ROUTE_STOP_NIGHTS_MAX, p.days ?? share) }));
  while (total(rows) > length) {
    const longest = rows.reduce((at, r, i) => (r.nights > rows[at].nights ? i : at), 0);
    if (rows[longest].nights <= 1) break;
    rows[longest].nights--;
  }
  for (let i = rows.length - 1; i >= 0 && total(rows) < length; i--) {
    rows[i].nights = Math.min(ROUTE_STOP_NIGHTS_MAX, rows[i].nights + length - total(rows));
  }
  return rows;
}

/** The places joined, as many as a destination's name holds. */
function placesLabel(names: string[]): string {
  for (let n = names.length; n > 1; n--) {
    const label = joinCities(names.slice(0, n));
    if (label.length <= DESTINATION_MAX_LENGTH) return label;
  }
  return names[0];
}

/**
 * Step 1's fields from a reading, or null when it says nothing step 1 holds.
 * Dates the traveller picked stay; otherwise the request's, else pencilled in
 * as for a one-sentence trip. Several places make a route when multi-city is
 * on, and a trip never runs past the most days it may have. A request with no
 * place keeps its time and who's going for the place picked next.
 */
export function fillOf(
  reading: RequestReading,
  opts: { today: string; multiCity: boolean; chosen: { start: string; end: string } | null }
): RequestFill | null {
  const places = reading.places.slice(0, MAX_CITIES);
  // With no place, what it says for the place picked next: a time, who's going.
  const timed = reading.days !== null || reading.startDate !== null || reading.month !== null;
  if (places.length === 0 && !timed && !reading.who && reading.vibes.length === 0 && !reading.budget) return null;
  const isRoute = opts.multiCity && places.length > 1;
  const cap = isRoute ? MAX_TRIP_DAYS_MULTI : MAX_TRIP_DAYS;

  const ownDays =
    places.length > 0 && places.every((p) => p.days !== null) ? places.reduce((sum, p) => sum + (p.days ?? 0), 0) : null;
  const dates = opts.chosen ?? (reading.startDate && reading.endDate ? { start: reading.startDate, end: reading.endDate } : null);
  const asked = dates ? tripSpanDays(dates.start, dates.end) : (reading.days ?? ownDays ?? (isRoute ? places.length * 3 : 5));
  const length = Math.max(isRoute ? places.length : 2, Math.min(asked, cap));
  const startDate = dates?.start ?? reading.startDate ?? pencilledDates({ days: length, month: reading.month }, opts.today).start;

  const route = isRoute ? routeRows(places, length) : null;
  const endDate = addIsoDays(startDate, (route ? total(route) : length) - 1) ?? startDate;
  // No place and no time: the dates stay as they are.
  const dated = places.length > 0 || timed;
  return {
    destination: route ? joinCities(route.map((r) => r.city)) : places.length > 0 ? placesLabel(reading.places.map((p) => p.name)) : "",
    route,
    startDate: dated ? startDate : "",
    endDate: dated ? endDate : "",
    datesSaid: dates !== null || reading.startDate !== null,
    capped: asked > cap ? cap : null,
    intent: reading.who === "friends" ? "group" : reading.who,
    vibes: reading.vibes,
    budget: reading.budget,
  };
}

/** How long the page waits for a reading before keeping the words as a note instead. */
const READ_TIMEOUT_MS = 12_000;

/** The request read by the server, or null when it couldn't be (the words then go to the notes). */
export async function fetchReading(text: string, locale: string, today: string): Promise<RequestReading | null> {
  try {
    const response = await fetch("/api/wizard/read-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, locale, today }),
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return ((await response.json()) as { reading?: RequestReading | null }).reading ?? null;
  } catch {
    return null;
  }
}
