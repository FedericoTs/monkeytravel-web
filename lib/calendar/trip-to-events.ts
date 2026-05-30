/**
 * Trip → IcalEvent[] adapter.
 *
 * Bridges the trip domain model (`ItineraryDay[]`, `Activity`) to the
 * format-agnostic `IcalEvent` shape consumed by `lib/calendar/ical.ts`.
 * Phase 1A defined the latter; this is the Phase 1B glue used by the
 * dynamic subscription feed and (eventually) the one-shot download
 * route.
 *
 * Time-of-day rules (see PRD §"Activity has no time"):
 *   - When activity.start_time + duration_minutes are present and
 *     parseable, we emit a timed VEVENT in the trip's destination
 *     timezone (or UTC fallback).
 *   - When start_time is absent, we synthesise 10:00 local for the
 *     first activity of the day, then stagger subsequent ones by 90
 *     minutes per the spec.
 *   - When the day has no `date` we skip the whole day rather than
 *     guess; calendar clients would otherwise show a misleading event.
 *
 * Timezone:
 *   - We do NOT do Google Places TZID lookup here (that's spec'd for
 *     Phase 2 with caching). For Phase 1B we use UTC, which Apple /
 *     Google / Outlook all interpret as the user's calendar default
 *     when no TZID is present — matches the behaviour of the existing
 *     legacy `lib/export/calendar.ts` exporter, so users won't see a
 *     regression when they switch from download → subscribe.
 */

import type { Activity, ItineraryDay } from "@/types";
import type { IcalEvent } from "./ical";

/**
 * Default start time when an activity has no `start_time`. Local
 * wall-clock; we pair it with `tzid: undefined` so calendar clients
 * render it in the user's tz.
 */
const DEFAULT_START_HOUR = 10;

/**
 * Stagger between untimed activities on the same day, in minutes.
 */
const STAGGER_MINUTES = 90;

/**
 * Fallback duration in minutes when activity.duration_minutes is
 * missing or non-positive. Matches the wizard's default block size.
 */
const DEFAULT_DURATION_MINUTES = 90;

/** Trim and crop descriptions per PRD §"Privacy". */
const MAX_DESCRIPTION_CHARS = 500;

const APP_ORIGIN = "https://monkeytravel.app";

export type TripForFeedEvents = {
  id: string;
  title: string;
  itinerary?: unknown; // JSONB from DB — validated structurally here
};

/**
 * Convert one trip into a flat array of VEVENT-ready records.
 * Returns [] for trips with no parseable itinerary — caller should
 * still concat without conditional checks.
 */
export function tripToIcalEvents(trip: TripForFeedEvents): IcalEvent[] {
  const days = parseItinerary(trip.itinerary);
  if (days.length === 0) return [];

  const events: IcalEvent[] = [];
  const tripUrl = `${APP_ORIGIN}/trips/${trip.id}`;

  for (let dayIdx = 0; dayIdx < days.length; dayIdx++) {
    const day = days[dayIdx];
    if (!day || !isValidDateString(day.date)) continue;
    const activities = Array.isArray(day.activities) ? day.activities : [];

    for (let actIdx = 0; actIdx < activities.length; actIdx++) {
      const activity = activities[actIdx];
      if (!activity || typeof activity !== "object") continue;

      const { dtstart, dtend } = resolveTimeWindow(
        day.date,
        activity,
        actIdx
      );
      if (!dtstart || !dtend) continue;

      const summary = stringOrEmpty(activity.name) || "(untitled activity)";
      const location =
        stringOrEmpty(activity.address) ||
        stringOrEmpty(activity.location) ||
        undefined;
      const description = buildDescription(activity, tripUrl);
      const geo = parseGeo(activity);

      events.push({
        // Stable, deterministic UID — re-imports dedupe by it.
        uid: `act-${trip.id}-${dayIdx}-${actIdx}@monkeytravel.app`,
        summary,
        description,
        location,
        geo,
        dtstart,
        dtend,
        // tzid intentionally omitted for Phase 1B — UTC fallback.
        // See module header for the Phase 2 plan.
      });
    }
  }

  return events;
}

/**
 * Convert multiple trips at once. Convenience for the feed route.
 */
export function tripsToIcalEvents(
  trips: readonly TripForFeedEvents[]
): IcalEvent[] {
  const out: IcalEvent[] = [];
  for (const trip of trips) {
    out.push(...tripToIcalEvents(trip));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function parseItinerary(raw: unknown): ItineraryDay[] {
  if (!Array.isArray(raw)) return [];
  return raw as ItineraryDay[];
}

function isValidDateString(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 10) return false;
  // YYYY-MM-DD prefix is enough; we let Date.parse handle the rest.
  const ts = Date.parse(value.slice(0, 10));
  return Number.isFinite(ts);
}

function resolveTimeWindow(
  dateStr: string,
  activity: Activity,
  fallbackIdx: number
): { dtstart: Date | null; dtend: Date | null } {
  const baseDay = dateStr.slice(0, 10);
  const start = parseStartTime(baseDay, activity.start_time, fallbackIdx);
  if (!start) return { dtstart: null, dtend: null };

  const durationMin =
    typeof activity.duration_minutes === "number" &&
    activity.duration_minutes > 0
      ? activity.duration_minutes
      : DEFAULT_DURATION_MINUTES;
  const end = new Date(start.getTime() + durationMin * 60_000);
  return { dtstart: start, dtend: end };
}

function parseStartTime(
  baseDay: string,
  raw: unknown,
  fallbackIdx: number
): Date | null {
  if (typeof raw === "string" && /^\d{1,2}:\d{2}/.test(raw)) {
    const [hh, mm] = raw.split(":").map((n) => Number(n));
    if (
      Number.isFinite(hh) &&
      Number.isFinite(mm) &&
      hh >= 0 &&
      hh <= 23 &&
      mm >= 0 &&
      mm <= 59
    ) {
      const dt = new Date(`${baseDay}T00:00:00Z`);
      if (Number.isNaN(dt.getTime())) return null;
      dt.setUTCHours(hh, mm, 0, 0);
      return dt;
    }
  }
  // Fallback: 10:00 + staggered.
  const dt = new Date(`${baseDay}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return null;
  const totalMinutes = DEFAULT_START_HOUR * 60 + fallbackIdx * STAGGER_MINUTES;
  const hours = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  dt.setUTCHours(hours, minutes, 0, 0);
  return dt;
}

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function buildDescription(activity: Activity, tripUrl: string): string {
  const desc = stringOrEmpty(activity.description);
  const cropped =
    desc.length > MAX_DESCRIPTION_CHARS
      ? desc.slice(0, MAX_DESCRIPTION_CHARS - 1).trimEnd() + "…"
      : desc;
  // Plain link line — clients render it as clickable. Keep it as the
  // last line so the description stays readable if trimmed by a UA.
  return cropped ? `${cropped}\n\n${tripUrl}` : tripUrl;
}

function parseGeo(
  activity: Activity
): { lat: number; lng: number } | undefined {
  const c = activity.coordinates;
  if (!c) return undefined;
  if (
    typeof c.lat !== "number" ||
    typeof c.lng !== "number" ||
    !Number.isFinite(c.lat) ||
    !Number.isFinite(c.lng)
  ) {
    return undefined;
  }
  return { lat: c.lat, lng: c.lng };
}
