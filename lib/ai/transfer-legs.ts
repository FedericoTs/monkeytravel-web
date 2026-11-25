/**
 * Inter-city transfer legs — P4 v1 of the transport spine
 * (docs/PRODUCT_PLAN_COCREATION_2026_08.md, Priority 4).
 *
 * The multi-city merge concatenated city blocks with NOTHING between them —
 * "otherwise it's just a list of activities". This module estimates the
 * transfer between consecutive cities from pure code + a distance heuristic
 * (no API): a `transport` activity on each leg-boundary morning, and the
 * "TRAIN · 4h 10m" transit label the JourneyRibbon has had a slot for since
 * the wedge shipped but nothing ever filled. When the answer of how travellers
 * make the hop (lib/ai/transfer-question.ts) can be right for the distance, the
 * card takes its way and ride time instead of the estimate.
 *
 * Estimates are deliberately advisory (rounded to 10 minutes, cost bands, no
 * schedules) — v2/v3 of the plan bring real bookings and search. Pure and
 * dependency-free so it unit-tests without runtime env.
 */

import type { Activity, ItineraryDay } from "@/types";
import { isPlaceholderPoint } from "@/lib/trip/placeholder-point";
import { formatMinutesToTime } from "@/lib/datetime/format";

/**
 * "ground" names no mode: a car, or a hop estimated from distance where trains aren't the usual way. A bus or a
 * ferry is named when the answer of how travellers make the hop says so.
 */
export type TransferMode = "train" | "flight" | "bus" | "ferry" | "ground";

export interface TransferEstimate {
  mode: TransferMode;
  durationMinutes: number;
  /** Rough one-way price band, in the trip currency. */
  estimatedCost: number;
  /** Straight-line distance the estimate was derived from; absent = unknown. */
  distanceKm?: number;
}

interface LatLng {
  lat: number;
  lng: number;
}

/** Great-circle distance in km. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const roundTo10 = (mins: number) => Math.round(mins / 10) * 10;

// Where trains are the usual way between nearby cities: Europe, Japan, South
// Korea and Taiwan.
const RAIL_REGIONS = [
  { lat: [35, 71.5], lng: [-10.5, 40] },
  { lat: [30, 46], lng: [128, 146] },
  { lat: [33, 39], lng: [124, 131] },
  { lat: [21.8, 25.4], lng: [119.9, 122.1] },
];

// Islands inside those regions. No train crosses to or from one, and only
// those with a railway of their own (`rail`) have trains from town to town.
// A box holding several islands (the Cyclades) has none: its hops are by sea.
const ISLANDS = [
  { lat: [36.3, 37.99], lng: [24.3, 26.0], rail: false }, // the Cyclades: Santorini, Mykonos, Naxos, Paros, Milos
  { lat: [34.8, 35.7], lng: [23.5, 26.4], rail: false }, // Crete
  { lat: [35.85, 36.47], lng: [27.68, 28.25], rail: false }, // Rhodes
  { lat: [36.7, 36.92], lng: [26.9, 27.37], rail: false }, // Kos
  { lat: [39.35, 39.8], lng: [19.6, 19.95], rail: false }, // Corfu
  { lat: [37.65, 37.95], lng: [20.6, 20.95], rail: false }, // Zakynthos
  { lat: [38.05, 38.5], lng: [20.3, 20.8], rail: false }, // Kefalonia
  { lat: [39.25, 39.97], lng: [2.3, 3.5], rail: true }, // Mallorca
  { lat: [38.6, 39.15], lng: [1.15, 1.65], rail: false }, // Ibiza and Formentera
  { lat: [39.78, 40.1], lng: [3.78, 4.35], rail: false }, // Menorca
  { lat: [38.85, 41.3], lng: [8.1, 9.85], rail: true }, // Sardinia
  { lat: [41.35, 43.05], lng: [8.5, 9.6], rail: true }, // Corsica
  { lat: [40.53, 40.57], lng: [14.19, 14.27], rail: false }, // Capri
  { lat: [40.69, 40.76], lng: [13.85, 13.96], rail: false }, // Ischia
  { lat: [35.78, 36.09], lng: [14.18, 14.58], rail: false }, // Malta and Gozo
  { lat: [51.4, 55.4], lng: [-10.6, -5.9], rail: true }, // Ireland
  { lat: [33.1, 33.6], lng: [126.1, 127.0], rail: false }, // Jeju
];

const inBox = (p: LatLng, r: { lat: number[]; lng: number[] }) =>
  p.lat >= r.lat[0] && p.lat <= r.lat[1] && p.lng >= r.lng[0] && p.lng <= r.lng[1];

/** Is the point somewhere trains are the usual way between nearby cities? */
export function inRailRegion(p: LatLng): boolean {
  return RAIL_REGIONS.some((r) => inBox(p, r));
}

/** Whether land joins the two points by rail: both on the mainland, or both on one island with a railway. */
export function railJoins(a: LatLng, b: LatLng): boolean {
  const island = ISLANDS.findIndex((r) => inBox(a, r));
  if (island !== ISLANDS.findIndex((r) => inBox(b, r))) return false;
  return island === -1 || ISLANDS[island].rail;
}

/** What each way adds to the ride: getting to the station, or to the airport and through it. */
const OVERHEAD: Record<TransferMode, number> = { train: 30, flight: 150, bus: 30, ferry: 30, ground: 30 };

/** A rough one-way price band for a hop of this length; a generic one when the length is unknown. */
function costOf(mode: TransferMode, km?: number): number {
  if (km === undefined) return 40;
  if (mode === "ground" || mode === "bus" || mode === "ferry") return Math.min(100, Math.max(10, Math.round(km * 0.1)));
  if (mode === "train") return Math.min(150, Math.max(10, Math.round(km * 0.15)));
  return Math.min(300, Math.max(50, Math.round(60 + km * 0.08)));
}

/**
 * Mode + door-to-door duration + price band from straight-line distance.
 * By rail: short hops read as regional trains, mid-range as fast trains, and
 * beyond ~700km a flight wins even with airport overhead. Elsewhere a hop up
 * to ~450km is a ground transfer of no named mode, at road speed. Null
 * distance (no usable coordinates) falls back to a generic half day.
 */
export function estimateTransfer(distanceKm: number | null, byRail = true): TransferEstimate {
  if (distanceKm === null || !Number.isFinite(distanceKm) || distanceKm <= 0) {
    return { mode: byRail ? "train" : "ground", durationMinutes: 180, estimatedCost: costOf("train") };
  }
  const km = Math.round(distanceKm);
  if (!byRail && km <= 450) {
    return { mode: "ground", durationMinutes: Math.max(30, roundTo10(km + OVERHEAD.ground)), estimatedCost: costOf("ground", km), distanceKm: km };
  }
  if (byRail && km <= 700) {
    const speedKmh = km < 300 ? 90 : 130; // regional vs fast train
    return {
      mode: "train",
      durationMinutes: Math.max(30, roundTo10((km / speedKmh) * 60 + OVERHEAD.train)),
      estimatedCost: costOf("train", km),
      distanceKm: km,
    };
  }
  return flightOver(km);
}

/** A flight of `km` on the straight line: cruise time, and check-in, security and transfers. */
function flightOver(km: number): TransferEstimate {
  return {
    mode: "flight",
    durationMinutes: roundTo10((km / 750) * 60 + OVERHEAD.flight),
    estimatedCost: costOf("flight", km),
    distanceKm: km,
  };
}

/** How travellers usually make a hop, as answered (lib/ai/transfer-question.ts). */
export interface KnownHop {
  mode: "train" | "flight" | "bus" | "car" | "ferry";
  /** The ride itself, without getting to the station, airport or port. */
  minutes: number;
}

/** The slowest and the fastest each way averages along the straight line between two places, in km/h. */
const SPEEDS: Record<KnownHop["mode"], [number, number]> = {
  train: [15, 320],
  flight: [100, 950],
  bus: [8, 110],
  car: [8, 110],
  ferry: [5, 80],
};
/** No flight between places closer than this. */
const SHORTEST_FLIGHT_KM = 100;
/**
 * A train or bus longer than this, between places at least FLOWN_FROM_KM apart, is flown: the question asks for the
 * flight then (lib/ai/transfer-question.ts), and an answer that keeps the day-long ride loses the arrival day.
 */
const LONG_LAND_MINUTES = 360;
const FLOWN_FROM_KM = 400;

/**
 * The hop as answered, when the answer can be right for the line between the two places: a ride of ten minutes to
 * a day, at a speed that way can make, no train to or from an island, no flight between near places. A car is a
 * transfer of no named mode. Null otherwise: the estimate from distance stands. With no point at either end the
 * answer is taken as it is.
 */
function fromAnswer(hop: KnownHop | undefined, from: LatLng | null, to: LatLng | null): TransferEstimate | null {
  if (!hop || !Object.prototype.hasOwnProperty.call(SPEEDS, hop.mode)) return null;
  if (!Number.isFinite(hop.minutes) || hop.minutes < 10 || hop.minutes > 24 * 60) return null;
  const mode: TransferMode = hop.mode === "car" ? "ground" : hop.mode;
  const km = from && to ? Math.round(haversineKm(from, to)) : undefined;
  if (km !== undefined) {
    const speed = km / (hop.minutes / 60);
    const [slowest, fastest] = SPEEDS[hop.mode];
    if (speed < slowest || speed > fastest) return null;
    if (hop.mode === "train" && !railJoins(from!, to!)) return null;
    if (hop.mode === "flight" && km < SHORTEST_FLIGHT_KM) return null;
    // A drive stays as answered: a road trip keeps its road.
    if ((hop.mode === "train" || hop.mode === "bus") && hop.minutes > LONG_LAND_MINUTES && km >= FLOWN_FROM_KM) return flightOver(km);
  }
  return {
    mode,
    durationMinutes: roundTo10(hop.minutes + OVERHEAD[mode]),
    estimatedCost: costOf(mode, km),
    ...(km !== undefined ? { distanceKm: km } : {}),
  };
}

// The price bands are in dollar-sized units: a trip priced in one of these
// keeps its currency, any other gets USD.
const DOLLAR_SIZED = new Set(["USD", "EUR", "GBP", "CHF", "CAD", "AUD", "NZD", "SGD"]);

type TransferLocale = "en" | "es" | "it" | "pt";

const LABELS: Record<
  TransferLocale,
  Record<TransferMode, string> & {
    name: Record<TransferMode, (city: string) => string>;
    description: (from: string, to: string) => string;
    /** The way back to the route's first city, at the end of its last day (buildWayBack). */
    wayBack: (to: string) => string;
  }
> = {
  en: {
    train: "TRAIN",
    flight: "FLIGHT",
    bus: "BUS",
    ferry: "FERRY",
    ground: "TRANSFER",
    name: {
      train: (c) => `Train to ${c}`,
      flight: (c) => `Flight to ${c}`,
      bus: (c) => `Bus to ${c}`,
      ferry: (c) => `Ferry to ${c}`,
      ground: (c) => `Transfer to ${c}`,
    },
    description: (from, to) =>
      `Estimated transfer from ${from} to ${to} — times and prices are indicative, book ahead for the best fares.`,
    wayBack: (to) => `Getting back to ${to}, where the trip began — times and prices are indicative, book ahead for the best fares.`,
  },
  it: {
    train: "TRENO",
    flight: "VOLO",
    bus: "AUTOBUS",
    ferry: "TRAGHETTO",
    ground: "TRASFERIMENTO",
    name: {
      train: (c) => `Treno per ${c}`,
      flight: (c) => `Volo per ${c}`,
      bus: (c) => `Autobus per ${c}`,
      ferry: (c) => `Traghetto per ${c}`,
      ground: (c) => `Trasferimento a ${c}`,
    },
    description: (from, to) =>
      `Trasferimento stimato da ${from} a ${to} — orari e prezzi indicativi, prenota in anticipo per le tariffe migliori.`,
    wayBack: (to) => `Per tornare a ${to}, dove è iniziato il viaggio — orari e prezzi indicativi, prenota in anticipo per le tariffe migliori.`,
  },
  es: {
    train: "TREN",
    flight: "VUELO",
    bus: "AUTOBÚS",
    ferry: "FERRY",
    ground: "TRASLADO",
    name: {
      train: (c) => `Tren a ${c}`,
      flight: (c) => `Vuelo a ${c}`,
      bus: (c) => `Autobús a ${c}`,
      ferry: (c) => `Ferry a ${c}`,
      ground: (c) => `Traslado a ${c}`,
    },
    description: (from, to) =>
      `Traslado estimado de ${from} a ${to} — horarios y precios orientativos, reserva con antelación para las mejores tarifas.`,
    wayBack: (to) => `Para volver a ${to}, donde empezó el viaje — horarios y precios orientativos, reserva con antelación para las mejores tarifas.`,
  },
  pt: {
    train: "TREM",
    flight: "VOO",
    bus: "ÔNIBUS",
    ferry: "BARCO",
    ground: "TRASLADO",
    name: {
      train: (c) => `Trem para ${c}`,
      flight: (c) => `Voo para ${c}`,
      bus: (c) => `Ônibus para ${c}`,
      ferry: (c) => `Barco para ${c}`,
      ground: (c) => `Traslado para ${c}`,
    },
    description: (from, to) =>
      `Traslado estimado de ${from} para ${to} — horários e preços indicativos, reserve com antecedência para as melhores tarifas.`,
    wayBack: (to) => `Para voltar a ${to}, onde a viagem começou — horários e preços indicativos, reserve com antecedência para as melhores tarifas.`,
  },
};

function resolveLocale(language?: string): TransferLocale {
  return language === "it" || language === "es" || language === "pt" ? language : "en";
}

/**
 * The middle of a city's places, as many north of it as south and east as
 * west, so one place pinned far away can't move it. Null with no usable pin.
 */
function middleOf(days: ItineraryDay[]): LatLng | null {
  const points = days
    .flatMap((day) => day.activities ?? [])
    .map((a) => a.coordinates)
    .filter((c): c is LatLng => !!c && Number.isFinite(c.lat) && Number.isFinite(c.lng) && (c.lat !== 0 || c.lng !== 0) && !isPlaceholderPoint(c.lat, c.lng));
  if (points.length === 0) return null;
  const mid = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  return { lat: mid(points.map((p) => p.lat)), lng: mid(points.map((p) => p.lng)) };
}

/** Whether the card between these two cities' days takes the answer (buildTransferActivity), for the log. */
export function answeredTransfer(known: KnownHop | undefined, fromDays: ItineraryDay[], toDays: ItineraryDay[]): boolean {
  return fromAnswer(known, middleOf(fromDays), middleOf(toDays)) !== null;
}

/**
 * Build the leg-boundary `transport` activity inserted at the start of the
 * next city's first day. No `id` — every downstream consumer runs
 * ensureActivityIds. Marked `transport_mode` so the JourneyRibbon (and any
 * future transport UI) can find it without string-matching names.
 */
export function buildTransferActivity(opts: {
  fromCity: string;
  toCity: string;
  /** Previous city's days: the hop is measured from their middle (middleOf). */
  fromDays: ItineraryDay[];
  /** Next city's days: the hop is measured to their middle. */
  toDays: ItineraryDay[];
  currency: string;
  language?: string;
  /** How travellers usually make the hop, as answered: taken when it can be right (answeredTransfer). */
  known?: KnownHop;
}): Activity {
  const from = middleOf(opts.fromDays);
  const to = middleOf(opts.toDays);
  const byRail = !!from && !!to && inRailRegion(from) && inRailRegion(to) && railJoins(from, to);
  const estimate =
    fromAnswer(opts.known, from, to) ?? estimateTransfer(from && to ? haversineKm(from, to) : null, byRail);
  const labels = LABELS[resolveLocale(opts.language)];

  return {
    time_slot: "morning",
    start_time: "08:30",
    duration_minutes: estimate.durationMinutes,
    name: labels.name[estimate.mode](opts.toCity),
    type: "transport",
    transport_mode: estimate.mode,
    description: labels.description(opts.fromCity, opts.toCity),
    location: opts.fromCity,
    estimated_cost: {
      amount: estimate.estimatedCost,
      currency: DOLLAR_SIZED.has(opts.currency) ? opts.currency : "USD",
      tier: "budget",
    },
    tips: [],
    booking_required: true,
  } as Activity;
}

const minutesOf = (time?: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(time ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
/** Time from arriving to the first stop in the new city. */
const ARRIVAL_BUFFER_MINUTES = 30;
/** Latest an activity moved past the transfer may end. */
const MOVED_BY = 20 * 60;
/** How far a meal may move: a lunch moved to the evening is no lunch. */
const MEAL_MOVE_MINUTES = 90;
const MEAL = /\b(?:restaurant|cafe|food\w*|bar|dining|meal|breakfast|brunch|lunch|dinner|colazione|pranzo|cena|desayuno|almuerzo|almoco|jantar)\b/;
const plain = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/**
 * The next city's first day with the transfer in it. What overlaps the
 * transfer moves, in order, to the first gap after arrival that holds it
 * (ending by 20:00; a meal only within 90 minutes of its time), or is left
 * out; what ends before it leaves or starts after arrival keeps its time. The
 * plan's own trip from the last city goes: the transfer stands for it.
 */
export function dayWithTransfer(transfer: Activity, activities: Activity[]): Activity[] {
  return arrivalDay(transfer, activities).activities;
}

/**
 * dayWithTransfer's day, and the sights it left out for want of a gap: they
 * can go to another day of the city (lib/ai/multi-city-core.ts). A meal left
 * out isn't among them: it belongs to its hour of that day.
 */
export function arrivalDay(transfer: Activity, activities: Activity[]): { activities: Activity[]; left: Activity[] } {
  const leave = minutesOf(transfer.start_time) ?? 8 * 60 + 30;
  const arrive = leave + (transfer.duration_minutes || 0) + ARRIVAL_BUFFER_MINUTES;
  const length = (a: Activity) => a.duration_minutes || 60;
  const lastCity = transfer.location ? plain(transfer.location) : "";
  const kept: Activity[] = [];
  const overlapping: Activity[] = [];
  for (const a of activities) {
    if (lastCity && a.type === "transport" && plain(a.name ?? "").includes(lastCity)) continue;
    const at = minutesOf(a.start_time);
    if (at === null || at >= arrive || at + length(a) <= leave) kept.push(a);
    else overlapping.push(a);
  }
  const busy = kept
    .map((a) => minutesOf(a.start_time))
    .flatMap((at, i) => (at === null ? [] : [[at, at + length(kept[i])] as [number, number]]));
  const moved: Activity[] = [];
  const left: Activity[] = [];
  let from = arrive;
  for (const a of overlapping.sort((x, y) => minutesOf(x.start_time)! - minutesOf(y.start_time)!)) {
    let at = from;
    for (const [start, end] of [...busy].sort((x, y) => x[0] - y[0])) {
      if (at < end && at + length(a) > start) at = end;
    }
    const meal = MEAL.test(plain(`${a.type} ${a.name}`));
    if (at + length(a) > MOVED_BY) {
      if (!meal) left.push(a);
      continue;
    }
    if (meal && at - minutesOf(a.start_time)! > MEAL_MOVE_MINUTES) continue;
    busy.push([at, at + length(a)]);
    from = at + length(a);
    moved.push({ ...a, start_time: formatMinutesToTime(at), time_slot: at < 12 * 60 ? "morning" : at < 17 * 60 ? "afternoon" : "evening" });
  }
  const order = (a: Activity) => minutesOf(a.start_time) ?? 24 * 60;
  return { activities: [transfer, ...kept, ...moved].sort((x, y) => order(x) - order(y)), left };
}

/** A route that ends at least this far from its first city closes with the way back to it. */
export const WAY_BACK_KM = 300;

/**
 * The way back from a route's last city to its first, for the end of the last day, when the route ends WAY_BACK_KM
 * or more from where it began: the flight home often leaves from the first city. Null when it ends nearer, or when
 * either city has no pin to measure from.
 */
export function buildWayBack(opts: Parameters<typeof buildTransferActivity>[0]): Activity | null {
  const from = middleOf(opts.fromDays);
  const to = middleOf(opts.toDays);
  if (!from || !to || haversineKm(from, to) < WAY_BACK_KM) return null;
  return { ...buildTransferActivity(opts), description: LABELS[resolveLocale(opts.language)].wayBack(opts.toCity) };
}

/** The way back gets in by then: later, it is a night ride after a full day there. */
const BACK_BY = 22 * 60;
/** A way back longer than this doesn't follow a day there: the plan says nothing rather than send them off at night. */
const LONGEST_WAY_BACK = 6 * 60;
/** The shortest a visit still on when the way back leaves is cut to. */
const SHORTEST_CUT = 60;

/**
 * The last day with the way back half an hour after its last stop, or sooner, to get in by ten at night: a full
 * last day sent 26 of 34 ways back in after midnight ("Train to London" at 21:05 for 4 h 30). A stop still on when
 * it must go is cut to end in time when an hour and half its visit remain, or gives way. A way back over six hours
 * is no evening ride: the day stays as it was, with none.
 */
export function dayWithWayBack(back: Activity, activities: Activity[]): Activity[] {
  const ride = back.duration_minutes || 0;
  if (ride > LONGEST_WAY_BACK) return activities;
  const ends = activities.flatMap((a) => {
    const at = minutesOf(a.start_time);
    return at === null ? [] : [at + (a.duration_minutes || 60)];
  });
  const leave = Math.min(ends.length > 0 ? Math.max(...ends) + ARRIVAL_BUFFER_MINUTES : 17 * 60, BACK_BY - ride);
  const doneBy = leave - ARRIVAL_BUFFER_MINUTES;
  const kept = activities.flatMap((a) => {
    const at = minutesOf(a.start_time);
    const length = a.duration_minutes || 60;
    if (at === null || at + length <= doneBy) return [a];
    const room = Math.floor((doneBy - at) / 5) * 5;
    return room >= Math.max(SHORTEST_CUT, length / 2) ? [{ ...a, duration_minutes: room }] : [];
  });
  const timeSlot = leave < 12 * 60 ? "morning" : leave < 17 * 60 ? "afternoon" : "evening";
  return [...kept, { ...back, start_time: formatMinutesToTime(leave), time_slot: timeSlot }];
}

export interface JourneyStopWithTransit {
  city: string;
  nights: number;
  /** "TRAIN · 4h 10m" — present when the stop's first day carries a transfer leg. */
  transitFromPrev?: string;
}

function formatTransitDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}h ${m.toString().padStart(2, "0")}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

/**
 * Derive the JourneyRibbon stops (city + consecutive nights) from city-tagged
 * days, with the transit label filled from the transfer leg on each city's
 * first day. Replaces the two hand-rolled mcStops loops (wizard + ongoing
 * view) and powers the trip-detail ribbon (P4 — first time it renders there).
 * Returns [] for single-city trips; callers hide the ribbon below 2 stops.
 */
export function buildJourneyStops(
  days: ItineraryDay[],
  language?: string
): JourneyStopWithTransit[] {
  const labels = LABELS[resolveLocale(language)];
  const stops: JourneyStopWithTransit[] = [];
  for (const day of days) {
    if (!day.city) continue;
    const last = stops[stops.length - 1];
    if (last && last.city === day.city) {
      last.nights += 1;
      continue;
    }
    const stop: JourneyStopWithTransit = { city: day.city, nights: 1 };
    // Transit label from the transfer leg on this city's first day — matched
    // by transport_mode (stamped by buildTransferActivity), with a type-based
    // fallback for transfers users edited by hand.
    const transfer = (day.activities ?? []).find(
      (a) =>
        (a as { transport_mode?: string }).transport_mode ||
        (stops.length > 0 && a.type === "transport" && a.time_slot === "morning")
    );
    if (stops.length > 0 && transfer) {
      const mode = labels[(transfer as { transport_mode?: TransferMode }).transport_mode ?? "train"] ?? labels.train;
      stop.transitFromPrev = `${mode} · ${formatTransitDuration(transfer.duration_minutes || 0)}`;
    }
    stops.push(stop);
  }
  return stops;
}
