/**
 * A trip through several cities (lib/ai/multi-city): each day is in its city,
 * and so are its places. The edit engine (lib/ai/assistant/engine.ts) holds a
 * change to that: asked to "cluster by areas", it once left Busan's sights on
 * Seoul's days, and gave a Seoul day to Busan.
 */

import { placesInOtherCities, type Point } from "@/lib/ai/multi-city-core";
import { normalizeActivityType } from "@/lib/trip/activity-type";
import { isRealPoint } from "@/lib/trip/placeholder-point";
import type { Activity, ItineraryDay } from "@/types";
import type { DayEdit } from "./edit-validation";
import { asksForDayTrip } from "./message-asks";
import { nameTokens, SAME_ACTIVITY, sameActivityScore, sameWord } from "./saved-activities";

const plain = (s: string) => ` ${s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
/** "Busan, South Korea" and "Busan" are one city. */
const cityKey = (city: string) => plain(city.split(",")[0]).trim();

/**
 * The edits with each day of the trip kept in its city: another city only when
 * the traveller names it ("spend day 5 in Busan").
 */
export function keepDayCities(days: ItineraryDay[], edits: DayEdit[], told: string): DayEdit[] {
  return edits.map((e) => {
    const was = days.find((d) => d.day_number === e.day_number)?.city;
    if (!was || !e.city) return e;
    const named = cityKey(e.city) !== "" && plain(told).includes(` ${cityKey(e.city)} `);
    return cityKey(e.city) === cityKey(was) || !named ? { ...e, city: undefined } : e;
  });
}

/** Places of a day that are in another city's area, and that city. */
export interface PlacesAway {
  day: number;
  /** The day's city. */
  city: string;
  /** The city the places are in. */
  other: string;
  activities: Activity[];
}

/**
 * The places on days of the plan, as the change leaves it, that are in another
 * city's area (placesInOtherCities), by day: on the days the change edits, or
 * on `onDays`. A day trip they asked for, a place they named, and travel stay
 * where they are. None on a trip to one place.
 */
export function placesAway(days: ItineraryDay[], edits: DayEdit[], message: string, onDays?: Set<number>): PlacesAway[] {
  if (!days.some((d) => d.city) || asksForDayTrip(message)) return [];
  const edited = new Map(edits.map((e) => [e.day_number, e]));
  const label = new Map<string, string>();
  const cityOf = (n: number) => {
    const city = edited.get(n)?.city ?? days.find((d) => d.day_number === n)?.city ?? days[days.length - 1]?.city;
    if (city && !label.has(cityKey(city))) label.set(cityKey(city), city.split(",")[0].trim());
    return city ? cityKey(city) : undefined;
  };
  // Named by its first word that tells it apart: "put Gamcheon on day 4".
  const said = nameTokens(message);
  const named = (a: Activity) => {
    const [first] = nameTokens(a.name);
    return first !== undefined && said.some((s) => sameWord(first, s));
  };
  const numbers = [...new Set([...days.map((d) => d.day_number), ...edited.keys()])].sort((a, b) => a - b);
  const places = numbers.flatMap((n) => {
    const city = cityOf(n);
    const activities = edited.get(n)?.activities ?? days.find((d) => d.day_number === n)?.activities ?? [];
    return city
      ? activities
          .filter((a) => normalizeActivityType(a.type, a.name) !== "transport" && isRealPoint(a.coordinates))
          .map((a) => ({ day: n, city, a }))
      : [];
  });
  const elsewhere = placesInOtherCities(places.map((p) => ({ city: p.city, point: p.a.coordinates as Point })));
  const checked = onDays ?? new Set(edited.keys());
  const byDay = new Map<number, PlacesAway>();
  for (const [k, other] of elsewhere) {
    const { day, city, a } = places[k];
    if (!checked.has(day) || named(a)) continue;
    const entry = byDay.get(day) ?? { day, city: label.get(city) ?? city, other: label.get(other) ?? other, activities: [] };
    entry.activities.push(a);
    byDay.set(day, entry);
  }
  return [...byDay.values()].sort((x, y) => x.day - y.day);
}

/** The numbers of a city's days: "Busan" and "Busan, South Korea" are one city. */
export function daysOfCity(days: ItineraryDay[], city: string): number[] {
  return days.filter((d) => d.city && cityKey(d.city) === cityKey(city)).map((d) => d.day_number);
}

/**
 * Of a day's places of another city, the ones the plan, as the change leaves
 * it, also holds on a day of that city: moved there, not lost.
 */
export function alsoInTheirCity(days: ItineraryDay[], edits: DayEdit[], x: PlacesAway): Activity[] {
  const there = new Set(
    [...new Set([...days.map((d) => d.day_number), ...edits.map((e) => e.day_number)])].filter((n) => {
      const city = edits.find((e) => e.day_number === n)?.city ?? days.find((d) => d.day_number === n)?.city;
      return n !== x.day && city !== undefined && cityKey(city) === cityKey(x.other);
    }),
  );
  const names = [...there].flatMap((n) => (edits.find((e) => e.day_number === n)?.activities ?? days.find((d) => d.day_number === n)?.activities ?? []).map((a) => a.name));
  return x.activities.filter((a) => names.some((n) => sameActivityScore({ name: n } as Activity, a) >= SAME_ACTIVITY || sameActivityScore(a, { name: n } as Activity) >= SAME_ACTIVITY));
}

/**
 * The edits without the places of another city on their days, and the places
 * taken off. A day they would leave with nothing stays as it was, unless every
 * one of them is on a day of its own city: then it is only a copy.
 */
export function withoutPlacesAway(days: ItineraryDay[], edits: DayEdit[], message: string): { edits: DayEdit[]; away: PlacesAway[] } {
  const away = placesAway(days, edits, message);
  if (away.length === 0) return { edits, away };
  const kept: DayEdit[] = [];
  const takenOff: PlacesAway[] = [];
  for (const e of edits) {
    const mine = away.find((x) => x.day === e.day_number);
    const left = mine ? e.activities.filter((a) => !mine.activities.includes(a)) : e.activities;
    if (mine && left.length === 0 && alsoInTheirCity(days, edits, mine).length < mine.activities.length) continue;
    kept.push({ ...e, activities: left });
    if (mine) takenOff.push(mine);
  }
  return { edits: kept, away: takenOff };
}
