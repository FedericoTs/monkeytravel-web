/**
 * Inter-city transfer legs — P4 v1 of the transport spine
 * (docs/PRODUCT_PLAN_COCREATION_2026_08.md, Priority 4).
 *
 * The multi-city merge concatenated city blocks with NOTHING between them —
 * "otherwise it's just a list of activities" (Ivan). This module estimates the
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

export type TransferMode = "train" | "flight";

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

/**
 * Mode + door-to-door duration + price band from straight-line distance.
 * Tiers: short hops read as regional trains, mid-range as fast trains,
 * beyond ~700km a flight wins even with airport overhead. Null distance
 * (no usable coordinates) falls back to a generic half-day train.
 */
export function estimateTransfer(distanceKm: number | null): TransferEstimate {
  if (distanceKm === null || !Number.isFinite(distanceKm) || distanceKm <= 0) {
    return { mode: "train", durationMinutes: 180, estimatedCost: 40 };
  }
  const km = Math.round(distanceKm);
  if (km <= 700) {
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

type TransferLocale = "en" | "es" | "it" | "pt";

const LABELS: Record<
  TransferLocale,
  { train: string; flight: string; name: Record<TransferMode, (city: string) => string>; description: (from: string, to: string) => string }
> = {
  en: {
    train: "TRAIN",
    flight: "FLIGHT",
    name: { train: (c) => `Train to ${c}`, flight: (c) => `Flight to ${c}` },
    description: (from, to) =>
      `Estimated transfer from ${from} to ${to} — times and prices are indicative, book ahead for the best fares.`,
  },
  it: {
    train: "TRENO",
    flight: "VOLO",
    name: { train: (c) => `Treno per ${c}`, flight: (c) => `Volo per ${c}` },
    description: (from, to) =>
      `Trasferimento stimato da ${from} a ${to} — orari e prezzi indicativi, prenota in anticipo per le tariffe migliori.`,
  },
  es: {
    train: "TREN",
    flight: "VUELO",
    name: { train: (c) => `Tren a ${c}`, flight: (c) => `Vuelo a ${c}` },
    description: (from, to) =>
      `Traslado estimado de ${from} a ${to} — horarios y precios orientativos, reserva con antelación para las mejores tarifas.`,
  },
  pt: {
    train: "TREM",
    flight: "VOO",
    name: { train: (c) => `Trem para ${c}`, flight: (c) => `Voo para ${c}` },
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
      if (c && Number.isFinite(c.lat) && Number.isFinite(c.lng) && (c.lat !== 0 || c.lng !== 0)) {
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
  const estimate = estimateTransfer(from && to ? haversineKm(from, to) : null);
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
      currency: opts.currency,
      tier: "budget",
    },
    tips: [],
    booking_required: true,
  } as Activity;
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
      const mode =
        (transfer as { transport_mode?: TransferMode }).transport_mode === "flight"
          ? labels.flight
          : labels.train;
      stop.transitFromPrev = `${mode} · ${formatTransitDuration(transfer.duration_minutes || 0)}`;
    }
    stops.push(stop);
  }
  return stops;
}
