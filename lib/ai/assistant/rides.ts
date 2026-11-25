/**
 * A trip through several cities reaches each new one with a ride (lib/ai/transfer-legs.ts buildTransferActivity, its
 * way and time as answered when the plan was made). A change that rewrites that day for something else ("no
 * restaurants", every day at once) can leave the ride out, and the plan then has the traveller in the next city with
 * no way of getting there. The edit engine (engine.ts) puts the plan's ride back.
 */

import { dayWithTransfer } from "@/lib/ai/transfer-legs";
import type { Activity, ItineraryDay } from "@/types";
import { cityKey } from "./city-days";
import type { DayEdit } from "./edit-validation";
import { JOURNEY } from "./travel-times";

/** A ride between places, as the plan or the change wrote it. */
const isRide = (a: Activity) => a.type === "transport" || !!a.transport_mode;

// Getting there in their words ("we'll drive", "no train", "quita el vuelo"): the change may take the ride out.
const GETTING_THERE =
  /(?<![\p{L}])(?:trains?|tren(?:es)?|tren[oi]|comboios?|trem|bus(?:es)?|autob[uú]s|pullman|[oô]nibus|coach|boats?|ferry|ferries|barcos?|traghett[oi]|balsas?|drive|driving|car|cars|auto|macchina|coche|carro|rides?)(?![\p{L}])/iu;

/**
 * The edits with the plan's ride on each edited day that reaches a new city without one: the ride the plan had
 * between the same two cities, wherever the change moved that day, at its time; what the change put during it moves
 * to after it arrives (dayWithTransfer). A day with a ride of the change's own keeps it. Nothing is put back when
 * the traveller talks about getting there, and no ride is made up for two cities the plan didn't go between.
 */
export function keepRides<E extends Pick<DayEdit, "day_number" | "activities" | "city">>(days: ItineraryDay[], edits: E[], told: string): E[] {
  if (JOURNEY.test(told) || GETTING_THERE.test(told)) return edits;
  const saved = new Map(days.map((d) => [d.day_number, d]));
  const rides = new Map<string, Activity>();
  for (const d of days) {
    const before = saved.get(d.day_number - 1)?.city;
    const ride = d.activities?.find((a) => a.type === "transport" && a.transport_mode);
    const hop = before && d.city ? `${cityKey(before)}>${cityKey(d.city)}` : "";
    if (ride && hop && cityKey(before!) !== cityKey(d.city!) && !rides.has(hop)) rides.set(hop, ride);
  }
  if (rides.size === 0) return edits;
  const edited = new Map(edits.map((e) => [e.day_number, e]));
  const cityOf = (n: number) => {
    const city = edited.get(n)?.city ?? saved.get(n)?.city;
    return city ? cityKey(city) : "";
  };
  return edits.map((e) => {
    const ride = rides.get(`${cityOf(e.day_number - 1)}>${cityOf(e.day_number)}`);
    if (!ride || e.activities.some(isRide)) return e;
    return { ...e, activities: dayWithTransfer(ride, e.activities) };
  });
}
