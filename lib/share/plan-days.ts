/**
 * The plan's days for the message that goes with a shared link. Friends in a chat read the message, not the link: one
 * that says where each day goes is worth reading by itself, and carries the link to the whole group.
 */
import { isDayStop, isMealStop } from "@/lib/trip/pace";

/** Days written out; the rest are counted. */
const MOST_DAYS = 7;
/** Places named for a day. */
const MOST_PLACES = 3;

export interface SharedDay {
  n: number;
  /** The day's city, on a trip through more than one. */
  city?: string;
  places: string[];
}

type Stop = { name: string; type: string | null; transport_mode: string | null };

const fields = (value: unknown): Record<string, unknown> => (value && typeof value === "object" ? (value as Record<string, unknown>) : {});
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const asStop = (value: unknown): Stop => {
  const raw = fields(value);
  return {
    name: text(raw.name),
    type: typeof raw.type === "string" ? raw.type : null,
    transport_mode: typeof raw.transport_mode === "string" ? raw.transport_mode : null,
  };
};
/** A place to go: not a meal, a ride or the hotel. */
const isSight = (stop: Stop) => isDayStop(stop) && !isMealStop(stop) && !/transport/i.test(stop.type ?? "");
const names = (stops: Stop[]) => stops.map((stop) => stop.name).filter(Boolean);

/**
 * Each day's number, its city on a trip through several, and up to three of its places in plan order: its sights, or
 * its first stops when it has none. A day with nothing named is left out. Seven days at most; `more` counts the rest.
 */
export function sharedDays(itinerary: unknown[]): { days: SharedDay[]; more: number } {
  const days = itinerary.map(fields);
  const cities = new Set(days.map((day) => text(day.city)).filter(Boolean));
  const written = days.slice(0, MOST_DAYS).flatMap((day, i): SharedDay[] => {
    const stops = (Array.isArray(day.activities) ? day.activities : []).map(asStop);
    const sights = names(stops.filter(isSight));
    const places = (sights.length > 0 ? sights : names(stops.filter(isDayStop))).slice(0, MOST_PLACES);
    if (places.length === 0) return [];
    const n = typeof day.day_number === "number" ? day.day_number : i + 1;
    const city = cities.size > 1 ? text(day.city) : "";
    return [city ? { n, city, places } : { n, places }];
  });
  return { days: written, more: Math.max(0, days.length - MOST_DAYS) };
}
