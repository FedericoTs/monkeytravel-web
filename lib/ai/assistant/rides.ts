/**
 * A trip through several cities reaches each new one with a ride (lib/ai/transfer-legs.ts buildTransferActivity, its
 * way and time as answered when the plan was made). A change that rewrites that day for something else ("no
 * restaurants", every day at once) can leave the ride out, and the plan then has the traveller in the next city with
 * no way of getting there. The edit engine (engine.ts) puts the plan's ride back. A change that moves the cities
 * ("drop Lisbon", "a night in Prague") can make a hop the plan never had: that day gets a ride made the way the plan
 * makes one when nobody answered how the hop is made (from the two cities' places), if the day still holds its stops.
 */

import { buildTransferActivity, dayWithTransfer } from "@/lib/ai/transfer-legs";
import { isRealPoint } from "@/lib/trip/placeholder-point";
import type { Activity, ItineraryDay } from "@/types";
import { cityKey } from "./city-days";
import type { DayEdit } from "./edit-validation";
import { JOURNEY } from "./travel-times";

/** A ride between places, as the plan or the change wrote it. */
const isRide = (a: Activity) => a.type === "transport" || !!a.transport_mode;

// Getting there in their words ("we'll drive", "no train", "quita el vuelo"): the change may take the ride out.
const GETTING_THERE =
  /(?<![\p{L}])(?:trains?|tren(?:es)?|tren[oi]|comboios?|trem|bus(?:es)?|autob[uú]s|pullman|[oô]nibus|coach|boats?|ferry|ferries|barcos?|traghett[oi]|balsas?|drive|driving|car|cars|auto|macchina|coche|carro|rides?)(?![\p{L}])/iu;

/** What a ride made for a new hop is written in: the plan's currency and the reply's language. */
export interface NewRides {
  currency: string;
  language?: string;
}

/**
 * The edits with a ride on each edited day that reaches a new city without one: the ride the plan had between the
 * same two cities, wherever the change moved that day, at its time; what the change put during it moves to after it
 * arrives (dayWithTransfer). For two cities the plan didn't go between, with `newRides`, a ride made from their
 * places, kept only when every stop of the day still fits around it (dayWithTransfer leaves none out). A day with a ride
 * of the change's own keeps it, and nothing is put in when the traveller talks about getting there.
 */
export function keepRides<E extends Pick<DayEdit, "day_number" | "activities" | "city">>(
  days: ItineraryDay[],
  edits: E[],
  told: string,
  newRides?: NewRides,
): E[] {
  if (JOURNEY.test(told) || GETTING_THERE.test(told) || !days.some((d) => d.city)) return edits;
  const saved = new Map(days.map((d) => [d.day_number, d]));
  // The plan's hops between two cities, and the ride it had for each.
  const hops = new Set<string>();
  const rides = new Map<string, Activity>();
  for (const d of days) {
    const before = saved.get(d.day_number - 1)?.city;
    const ride = d.activities?.find((a) => a.type === "transport" && a.transport_mode);
    const hop = before && d.city && cityKey(before) !== cityKey(d.city) ? `${cityKey(before)}>${cityKey(d.city)}` : "";
    if (hop) hops.add(hop);
    if (ride && hop && !rides.has(hop)) rides.set(hop, ride);
  }
  const edited = new Map(edits.map((e) => [e.day_number, e]));
  const cityName = (n: number) => edited.get(n)?.city ?? saved.get(n)?.city ?? "";
  const cityOf = (n: number) => (cityName(n) ? cityKey(cityName(n)) : "");
  // Each day of the trip as the change leaves it, for the places a new ride is measured between.
  const numbers = [...new Set([...days.map((d) => d.day_number), ...edits.map((e) => e.day_number)])];
  const daysIn = (key: string) =>
    numbers.filter((n) => cityOf(n) === key).map((n) => ({ day_number: n, activities: edited.get(n)?.activities ?? saved.get(n)?.activities ?? [] }) as ItineraryDay);
  const pinned = (list: ItineraryDay[]) => list.some((d) => d.activities.some((a) => a.type !== "transport" && isRealPoint(a.coordinates)));
  return edits.map((e) => {
    const from = cityOf(e.day_number - 1);
    const to = cityOf(e.day_number);
    if (!from || !to || from === to || e.activities.some(isRide)) return e;
    const ride = rides.get(`${from}>${to}`);
    if (ride) return { ...e, activities: dayWithTransfer(ride, e.activities) };
    // A hop the plan had with no ride (taken out on purpose, perhaps) stays without one.
    if (!newRides || hops.has(`${from}>${to}`)) return e;
    const fromDays = daysIn(from);
    const toDays = daysIn(to);
    if (!pinned(fromDays) || !pinned(toDays)) return e;
    const made = buildTransferActivity({
      fromCity: cityName(e.day_number - 1).split(",")[0].trim(),
      toCity: cityName(e.day_number).split(",")[0].trim(),
      fromDays,
      toDays,
      currency: newRides.currency,
      language: newRides.language,
    });
    const arrived = dayWithTransfer(made, e.activities);
    // Every stop of the day still there, the ride added: else the day stays as the change wrote it.
    return arrived.length === e.activities.length + 1 ? { ...e, activities: arrived } : e;
  });
}
