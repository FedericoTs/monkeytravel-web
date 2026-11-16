/**
 * The times a traveller arrives or leaves on a day, and the activities a reply
 * plans outside them.
 */

import { formatMinutesToTime } from "@/lib/datetime/format";
import type { ItineraryDay } from "@/types";
import { clockTime, num, type DayEdit } from "./edit-validation";
import { TELLS_TIME } from "./message-asks";

/** A time the traveller arrives or leaves on a day ("travel_times"). */
export interface TravelTime {
  day: number;
  arrives?: string;
  leaves?: string;
  by?: string;
}

// Minutes from arriving to being free, and from setting off to the departure.
const TRAVEL_MARGIN: Record<string, { after: number; before: number }> = {
  flight: { after: 90, before: 180 },
  train: { after: 45, before: 60 },
  bus: { after: 45, before: 60 },
  boat: { after: 45, before: 60 },
  car: { after: 30, before: 30 },
};
// The journey itself: getting from the airport, checking in, getting there.
const JOURNEY =
  /(?<![\p{L}])(?:airports?|aeropuertos?|aeroport[oi]s?|aéroport|transfers?|traslados?|trasferiment[oi]|translados?|arrival|arrive|arriving|arriv[oi]|llegadas?|chegadas?|departure|depart|departing|salidas?|partenz[ae]|partidas?|check[\s-]?(?:in|out)|flights?|vuelos?|vol[oi]|voos?|stations?|estaci[oó]n|stazion[ei]|esta[cç][aã]o|luggage|baggage|equipaje|bagagli|bagagem)(?![\p{L}])/iu;
/** Slack before a time counts as outside it. */
const TRAVEL_SLACK = 15;

/** Minutes into the day of "H:MM", "HH:MM" or "9:30 AM"; NaN when it doesn't read. */
export const minutesOf = (time: unknown) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(clockTime(time) ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

/** A day's activities outside the hours around an arrival or a departure. */
export interface OutsideTravelTimes {
  day: number;
  arrives?: string;
  leaves?: string;
  /** Free from, after arriving. */
  from: string | null;
  /** Done by, to set off. */
  until: string | null;
  /** The activities outside, with their start times. */
  names: string[];
}

// The plan's own way home on its last day: "Flight home", "Train to the airport",
// "Voo de regresso a casa", "Ida para o aeroporto".
const HOMEWARD =
  /(?<![\p{L}])(?:home|airport|aeropuerto|aeroporto|aéroport|flights?|vuelos?|vol[oi]|voos?|departure|depart|salida|partenza|partida|regreso|ritorno|regresso|retorno|volta|casa)(?![\p{L}])/iu;
const BY: Array<[RegExp, string]> = [
  [/(?<![\p{L}])(?:trains?|tren|treno|comboio|trem)(?![\p{L}])/iu, "train"],
  [/(?<![\p{L}])(?:bus|autob[uú]s|autobus|[oô]nibus)(?![\p{L}])/iu, "bus"],
  [/(?<![\p{L}])(?:boat|ferry|barco|traghetto|balsa)(?![\p{L}])/iu, "boat"],
];

/**
 * The plan's own way home: the last transport stop of its last day that
 * names a way home or a departure. When it leaves is when the traveller
 * leaves, as if they had said so; nothing after it can happen.
 */
export function planDeparture(days: ItineraryDay[]): (TravelTime & { id?: string; name: string }) | null {
  const last = days[days.length - 1];
  const leaving = [...(Array.isArray(last?.activities) ? last.activities : [])]
    .reverse()
    .find((a) => a?.type === "transport" && typeof a.name === "string" && HOMEWARD.test(a.name));
  const leaves = clockTime(leaving?.start_time);
  if (!leaving || !leaves) return null;
  const by = BY.find(([re]) => re.test(leaving.name))?.[1] ?? "flight";
  return { day: last.day_number, leaves, by, id: leaving.id, name: leaving.name };
}

/** The times they told, with the plan's own way home on its last day unless they told when they leave then. */
export function withPlanDeparture(told: TravelTime[], days: ItineraryDay[]): TravelTime[] {
  const home = planDeparture(days);
  if (!home || told.some((t) => t.day === home.day && t.leaves)) return told;
  const { id: _id, name: _name, ...time } = home;
  return [...told, time];
}

/**
 * The edits with the plan's way home back at its time, unless the message
 * gives one: a change to the last day may move other stops, not the way home.
 */
export function keepDepartureTime<E extends Pick<DayEdit, "day_number" | "activities">>(days: ItineraryDay[], edits: E[], message: string): E[] {
  const home = planDeparture(days);
  if (!home || TELLS_TIME.test(message)) return edits;
  const saved = days[days.length - 1].activities.find((a) => (home.id ? a.id === home.id : a.name === home.name));
  if (!saved) return edits;
  return edits.map((e) =>
    e.day_number !== home.day
      ? e
      : {
          ...e,
          activities: e.activities.map((a) =>
            (home.id ? a.id === home.id : a.name === home.name)
              ? { ...a, start_time: saved.start_time, time_slot: saved.time_slot, duration_minutes: saved.duration_minutes }
              : a,
          ),
        },
  );
}

/** "travel_times" as the model wrote them, kept when the day and a time read. */
export function readTravelTimes(raw: unknown, length: number): TravelTime[] {
  return (Array.isArray(raw) ? raw : []).flatMap((r) => {
    const t = (r ?? {}) as Record<string, unknown>;
    const day = Math.round(num(t.day, 0));
    const arrives = clockTime(t.arrives) ?? undefined;
    const leaves = clockTime(t.leaves) ?? undefined;
    if (day < 1 || day > length || (!arrives && !leaves)) return [];
    return [{ day, arrives, leaves, by: typeof t.by === "string" ? t.by.trim().toLowerCase() : undefined }];
  });
}

/**
 * Activities the edited days plan before the traveller is free after arriving,
 * or after they must set off (pure; unit-tested): the model will keep lunch
 * on a day with a 14:00 flight home, or plan dinner on a day that lands at
 * 23:00.
 */
export function outsideTravelTimes(
  edits: Pick<DayEdit, "day_number" | "activities">[],
  times: TravelTime[],
): OutsideTravelTimes[] {
  return edits.flatMap((e) => {
    const t = times.find((x) => x.day === e.day_number);
    if (!t) return [];
    const margin = TRAVEL_MARGIN[t.by ?? ""] ?? TRAVEL_MARGIN.flight;
    const from = t.arrives ? minutesOf(t.arrives) + margin.after : 0;
    const until = t.leaves ? minutesOf(t.leaves) - margin.before : 24 * 60;
    const names = e.activities
      .filter((a) => a.type !== "transport" && a.type !== "accommodation" && !a.transport_mode && !JOURNEY.test(a.name))
      .filter((a) => {
        const start = minutesOf(a.start_time);
        if (Number.isNaN(start)) return false;
        return start < from - TRAVEL_SLACK || start + (a.duration_minutes || 0) > until + TRAVEL_SLACK;
      })
      .map((a) => `${a.name} (${a.start_time})`);
    if (names.length === 0) return [];
    return [{
      day: e.day_number,
      arrives: t.arrives,
      leaves: t.leaves,
      from: t.arrives ? formatMinutesToTime(Math.min(from, 24 * 60 - 1)) : null,
      until: t.leaves ? formatMinutesToTime(Math.max(until, 0)) : null,
      names,
    }];
  });
}
