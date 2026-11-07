import "server-only";
import tzlookup from "tz-lookup";
import { sunTimes } from "@/lib/sky/sun";
import { isValidTimeZone } from "@/lib/trip/live";
import type { TripDaylight } from "@/types";

/**
 * When the sun rises and sets at the destination on the trip's first and last
 * day, for the prompt: plans used to put a "sunset" stop hours from the sunset.
 * Worked out here from the coordinates the planner sends; the request's own
 * text never reaches the prompt.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Coordinates as the planner sends them, or null when they aren't a real place. */
export function readCoordinates(value: unknown): { lat: number; lng: number } | null {
  if (!value || typeof value !== "object") return null;
  const { latitude, longitude } = value as Record<string, unknown>;
  if (typeof latitude !== "number" || typeof longitude !== "number") return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || (latitude === 0 && longitude === 0)) return null;
  return { lat: latitude, lng: longitude };
}

const clock = (minutes: number | null): string | null => {
  if (minutes === null) return null;
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

export function daylightFor(coords: { lat: number; lng: number } | null, startDate: unknown, endDate: unknown): TripDaylight | undefined {
  if (!coords || typeof startDate !== "string" || typeof endDate !== "string") return undefined;
  if (!ISO_DATE.test(startDate) || !ISO_DATE.test(endDate)) return undefined;
  let zone: string;
  try {
    zone = tzlookup(coords.lat, coords.lng);
  } catch {
    return undefined;
  }
  if (!isValidTimeZone(zone)) return undefined;
  const on = (date: string) => {
    const sun = sunTimes(date, coords.lat, coords.lng, zone);
    return { sunrise: clock(sun.sunrise), sunset: clock(sun.sunset), ...(sun.polar ? { polar: sun.polar } : {}) };
  };
  return { first: on(startDate), last: on(endDate) };
}
