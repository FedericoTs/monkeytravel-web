/**
 * When a dinner can start where a day ends. Restaurants in Spain open for dinner around 20:00 to 20:30, and in
 * Italy, France, Portugal and Greece around 19:00 to 19:30, so a dinner planned for 18:30 there finds the kitchen
 * shut; elsewhere 18:30 is a dinner hour. Read from the time zone of the place's pin (tz-lookup, server only). A
 * family with young children eats early wherever it is (lib/ai/trip-prompt.ts asks for dinner by 18:30 or 19:00):
 * it gets the usual hours, and a place open then.
 */
import tzlookup from "tz-lookup";
import { formatMinutesToTime } from "@/lib/datetime/format";
import { isRealPoint } from "@/lib/trip/placeholder-point";
import type { TripCreationParams } from "@/types";

/** Minutes into the day: the earliest a dinner starts, and the latest. */
export interface DinnerHours {
  from: number;
  by: number;
}

const USUAL: DinnerHours = { from: 18 * 60 + 30, by: 21 * 60 };
const SPAIN: DinnerHours = { from: 20 * 60 + 30, by: 22 * 60 };
const LATER: DinnerHours = { from: 19 * 60 + 30, by: 21 * 60 };
const BY_ZONE: Record<string, DinnerHours> = {
  "Europe/Madrid": SPAIN,
  "Atlantic/Canary": SPAIN,
  "Africa/Ceuta": SPAIN,
  "Europe/Rome": LATER,
  "Europe/Vatican": LATER,
  "Europe/San_Marino": LATER,
  "Europe/Paris": LATER,
  "Europe/Monaco": LATER,
  "Europe/Lisbon": LATER,
  "Atlantic/Madeira": LATER,
  "Atlantic/Azores": LATER,
  "Europe/Athens": LATER,
};

/** The dinner hours where this pin is: the usual ones with no pin, for a family that eats early, or anywhere else. */
export function dinnerHours(at: { lat: number; lng: number } | null | undefined, early = false): DinnerHours {
  if (early || !at) return USUAL;
  try {
    return BY_ZONE[tzlookup(at.lat, at.lng)] ?? USUAL;
  } catch {
    return USUAL;
  }
}

type Stop = { type?: string | null; start_time?: string | null; coordinates?: { lat: number; lng: number } | null };
type Day = { activities?: Stop[] };

/** A dinner this many minutes or less before the local hour is at it. */
const SLACK_MINUTES = 30;
const DINNER = /restaur|ristorant|dining|^food$/i;

const minutesOf = (time?: string | null): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(time ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/**
 * The plan's own dinners at the local hour. Told that dinner in Spain is from about 20:30, plans still ended days in
 * Cádiz or Barcelona with one at 19:30: a day's last stop, a restaurant from 17:00 that starts more than half an hour
 * before dinner is served where it is, moves to that hour. One with a stop after it stays, as moving it would crowd
 * that stop; so do a family's that eats early, and one whose pin is the placeholder of no place. Pure.
 */
export function atLocalDinnerHour<D extends Day>(days: D[], early = false): { days: D[]; moved: number } {
  if (early) return { days, moved: 0 };
  let moved = 0;
  const out = days.map((day) => {
    const stops = day.activities ?? [];
    const timed = stops.filter((s) => minutesOf(s.start_time) !== null);
    const last = timed.reduce<Stop | null>((latest, s) => (!latest || minutesOf(s.start_time)! > minutesOf(latest.start_time)! ? s : latest), null);
    if (!last || !DINNER.test(last.type ?? "") || !isRealPoint(last.coordinates)) return day;
    const start = minutesOf(last.start_time)!;
    const { from } = dinnerHours(last.coordinates);
    if (start < 17 * 60 || start >= from - SLACK_MINUTES) return day;
    moved++;
    return { ...day, activities: stops.map((s) => (s === last ? { ...s, start_time: formatMinutesToTime(from) } : s)) };
  });
  return { days: moved > 0 ? out : days, moved };
}

/** A family with a child under seven, or one that gave no ages: its dinners are early. */
export function eatsEarly(params: Pick<TripCreationParams, "tripIntent" | "childrenAges">): boolean {
  if (params.tripIntent !== "family") return false;
  const ages = params.childrenAges ?? [];
  return ages.length === 0 || ages.some((band) => band === "under3" || band === "3to6");
}
