/**
 * Inter-city transfer legs — P4 v1 of the transport spine
 * (docs/PRODUCT_PLAN_COCREATION_2026_08.md, Priority 4).
 *
 * The multi-city merge concatenated city blocks with NOTHING between them —
 * "otherwise it's just a list of activities". This module estimates the
 * transfer between consecutive cities from pure code + a distance heuristic
 * (no API): a `transport` activity on each leg-boundary morning, and the
 * "TRAIN · 4h 10m" transit label the JourneyRibbon has had a slot for since
 * the wedge shipped but nothing ever filled.
 *
 * Estimates are deliberately advisory (rounded to 10 minutes, cost bands, no
 * schedules) — v2/v3 of the plan bring real bookings and search. Pure and
 * dependency-free so it unit-tests without runtime env.
 */

import type { Activity, ItineraryDay } from "@/types";
import { isPlaceholderPoint } from "@/lib/trip/placeholder-point";

/** "ground" names no mode: where trains aren't the usual way, it may be a bus, a car or a boat. */
export type TransferMode = "train" | "flight" | "ground";

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

/** Is the point somewhere trains are the usual way between nearby cities? */
export function inRailRegion(p: LatLng): boolean {
  return RAIL_REGIONS.some((r) => p.lat >= r.lat[0] && p.lat <= r.lat[1] && p.lng >= r.lng[0] && p.lng <= r.lng[1]);
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
    return { mode: byRail ? "train" : "ground", durationMinutes: 180, estimatedCost: 40 };
  }
  const km = Math.round(distanceKm);
  if (!byRail && km <= 450) {
    return {
      mode: "ground",
      durationMinutes: Math.max(30, roundTo10(km + 30)),
      estimatedCost: Math.min(100, Math.max(10, Math.round(km * 0.1))),
      distanceKm: km,
    };
  }
  if (byRail && km <= 700) {
    const speedKmh = km < 300 ? 90 : 130; // regional vs fast train
    return {
      mode: "train",
      durationMinutes: Math.max(30, roundTo10((km / speedKmh) * 60 + 30)),
      estimatedCost: Math.min(150, Math.max(10, Math.round(km * 0.15))),
      distanceKm: km,
    };
  }
  return {
    mode: "flight",
    // Cruise time + check-in/security/transfers overhead.
    durationMinutes: roundTo10((km / 750) * 60 + 150),
    estimatedCost: Math.min(300, Math.max(50, Math.round(60 + km * 0.08))),
    distanceKm: km,
  };
}

// The price bands are in dollar-sized units: a trip priced in one of these
// keeps its currency, any other gets USD.
const DOLLAR_SIZED = new Set(["USD", "EUR", "GBP", "CHF", "CAD", "AUD", "NZD", "SGD"]);

type TransferLocale = "en" | "es" | "it" | "pt";

const LABELS: Record<
  TransferLocale,
  Record<TransferMode, string> & { name: Record<TransferMode, (city: string) => string>; description: (from: string, to: string) => string }
> = {
  en: {
    train: "TRAIN",
    flight: "FLIGHT",
    ground: "TRANSFER",
    name: { train: (c) => `Train to ${c}`, flight: (c) => `Flight to ${c}`, ground: (c) => `Transfer to ${c}` },
    description: (from, to) =>
      `Estimated transfer from ${from} to ${to} — times and prices are indicative, book ahead for the best fares.`,
  },
  it: {
    train: "TRENO",
    flight: "VOLO",
    ground: "TRASFERIMENTO",
    name: { train: (c) => `Treno per ${c}`, flight: (c) => `Volo per ${c}`, ground: (c) => `Trasferimento a ${c}` },
    description: (from, to) =>
      `Trasferimento stimato da ${from} a ${to} — orari e prezzi indicativi, prenota in anticipo per le tariffe migliori.`,
  },
  es: {
    train: "TREN",
    flight: "VUELO",
    ground: "TRASLADO",
    name: { train: (c) => `Tren a ${c}`, flight: (c) => `Vuelo a ${c}`, ground: (c) => `Traslado a ${c}` },
    description: (from, to) =>
      `Traslado estimado de ${from} a ${to} — horarios y precios orientativos, reserva con antelación para las mejores tarifas.`,
  },
  pt: {
    train: "TREM",
    flight: "VOO",
    ground: "TRASLADO",
    name: { train: (c) => `Trem para ${c}`, flight: (c) => `Voo para ${c}`, ground: (c) => `Traslado para ${c}` },
    description: (from, to) =>
      `Traslado estimado de ${from} para ${to} — horários e preços indicativos, reserve com antecedência para as melhores tarifas.`,
  },
};

function resolveLocale(language?: string): TransferLocale {
  return language === "it" || language === "es" || language === "pt" ? language : "en";
}

/** First activity with usable coordinates in a list of days (search order as given). */
function firstCoords(days: ItineraryDay[]): LatLng | null {
  for (const day of days) {
    for (const a of day.activities ?? []) {
      const c = a.coordinates;
      if (c && Number.isFinite(c.lat) && Number.isFinite(c.lng) && (c.lat !== 0 || c.lng !== 0) && !isPlaceholderPoint(c.lat, c.lng)) {
        return c;
      }
    }
  }
  return null;
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
  /** Previous city's days (searched last→first for departure coordinates). */
  fromDays: ItineraryDay[];
  /** Next city's days (searched first→last for arrival coordinates). */
  toDays: ItineraryDay[];
  currency: string;
  language?: string;
}): Activity {
  const from = firstCoords([...opts.fromDays].reverse());
  const to = firstCoords(opts.toDays);
  const byRail = !!from && !!to && inRailRegion(from) && inRailRegion(to);
  const estimate = estimateTransfer(from && to ? haversineKm(from, to) : null, byRail);
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
const clock = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
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
  let from = arrive;
  for (const a of overlapping.sort((x, y) => minutesOf(x.start_time)! - minutesOf(y.start_time)!)) {
    let at = from;
    for (const [start, end] of [...busy].sort((x, y) => x[0] - y[0])) {
      if (at < end && at + length(a) > start) at = end;
    }
    if (at + length(a) > MOVED_BY) continue;
    if (MEAL.test(plain(`${a.type} ${a.name}`)) && at - minutesOf(a.start_time)! > MEAL_MOVE_MINUTES) continue;
    busy.push([at, at + length(a)]);
    from = at + length(a);
    moved.push({ ...a, start_time: clock(at), time_slot: at < 12 * 60 ? "morning" : at < 17 * 60 ? "afternoon" : "evening" });
  }
  const order = (a: Activity) => minutesOf(a.start_time) ?? 24 * 60;
  return [transfer, ...kept, ...moved].sort((x, y) => order(x) - order(y));
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
