/**
 * What the model's reply becomes before anyone reads it: its revised days checked
 * against the trip, and every activity given the fields the views need.
 */

import { lockedActivityNames } from "@/lib/ai/anchors-core";
import { maxTripDays } from "@/lib/ai/assistant/structural";
import type { Activity, ItineraryDay } from "@/types";
import { normalizeActivityType } from "@/lib/trip/activity-type";
import { knownPoints, stopLocation } from "./stop-location";

const VALID_TIME_SLOTS = new Set(["morning", "afternoon", "evening"]);
const VALID_TIERS = new Set(["free", "budget", "moderate", "expensive"]);

export interface DayEdit {
  /** 1-based day number this edit replaces (or adds, with a longer trip). */
  day_number: number;
  /** One-line, human-readable summary of what changed. */
  summary: string;
  /** Normalized full activities for the revised day. */
  activities: Activity[];
  /** Optional revised day theme. */
  theme?: string;
  /** Multi-city trips: the city this day now takes place in. */
  city?: string;
}

/**
 * The panel shows replies as plain text, so Markdown would print as asterisks:
 * "**Costo attività:**", "*   Voli…". Bold is dropped and bullets become "- ".
 */
export function plainText(reply: string): string {
  return reply.replace(/\*\*(.+?)\*\*/g, "$1").replace(/^[ \t]*[*•][ \t]+/gm, "- ");
}

export function str(v: unknown, fallback: string): string {
  return typeof v === "string" && v.trim() ? v : fallback;
}
export function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** A start time as "HH:MM" (read from "9:30 AM" or "21h30" too), or null. */
export function clockTime(v: unknown): string | null {
  const s = String(v ?? "").trim().toLowerCase();
  const hm = (h: number, m: number) => (h < 24 && m < 60 ? `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}` : null);
  if (/^\d{1,2}:\d{2}$/.test(s)) return hm(Number(s.split(":")[0]), Number(s.split(":")[1])) && s;
  const ampm = /^(\d{1,2})(?:[:.](\d{2}))?\s*([ap])\.?\s*m\.?$/.exec(s);
  if (ampm && Number(ampm[1]) >= 1 && Number(ampm[1]) <= 12) {
    return hm((Number(ampm[1]) % 12) + (ampm[3] === "p" ? 12 : 0), Number(ampm[2] ?? 0));
  }
  const h = /^(\d{1,2})h(\d{2})?$/.exec(s);
  return h ? hm(Number(h[1]), Number(h[2] ?? 0)) : null;
}

function normalizeActivity(raw: unknown, idx: number, cur: string, known: { lat: number; lng: number }[]): Activity | null {
  const a = (raw ?? {}) as Record<string, unknown>;
  const name = typeof a.name === "string" ? a.name.trim() : "";
  if (!name) return null; // no name → unrenderable, drop
  const coordinates = stopLocation(a.coordinates, known);
  const slot = VALID_TIME_SLOTS.has(String(a.time_slot))
    ? String(a.time_slot)
    : idx === 0
      ? "morning"
      : idx === 1
        ? "afternoon"
        : "evening";
  const costRaw = (a.estimated_cost ?? {}) as Record<string, unknown>;
  const tier = VALID_TIERS.has(String(costRaw.tier)) ? String(costRaw.tier) : "moderate";
  return {
    time_slot: slot,
    // A real slot-based fallback (never "") so downstream iCal export can't
    // produce a corrupt DTSTART when the model omits start_time.
    start_time: clockTime(a.start_time) ?? (slot === "morning" ? "09:00" : slot === "afternoon" ? "13:00" : "19:00"),
    duration_minutes: Math.max(15, Math.round(num(a.duration_minutes, 90))),
    name,
    type: normalizeActivityType(a.type, name),
    description: str(a.description, ""),
    location: str(a.location, ""),
    estimated_cost: {
      amount: Math.max(0, Math.round(num(costRaw.amount, 0))),
      currency: str(costRaw.currency, cur),
      tier,
    },
    tips: Array.isArray(a.tips) ? (a.tips as unknown[]).map(String).slice(0, 4) : [],
    booking_required: a.booking_required === true,
    ...(coordinates ? { coordinates } : {}),
  } as Activity;
}

/**
 * Validate the model's edits against the trip. Pure, so the rules are
 * unit-tested (lib/ai/assistant/engine-edits.vitest.ts).
 *
 * - A new trip length counts only if every added day comes back in full, or
 *   is one of "more_days", which the next parts bring; a shorter one may not
 *   drop a day holding a fixed plan (F1 anchor).
 * - A day holding a fixed plan is never rewritten: an edit REPLACES the whole
 *   day, and anchors are the traveller's to remove.
 * - Edits for days outside the trip are dropped; one per day (the last wins).
 */
export function validateEdits(
  days: ItineraryDay[],
  raw: { edits: unknown[]; tripLength: unknown; moreDays?: unknown },
  cur: string,
  /** The traveller asked for a free day, so a day emptied is the change. */
  allowEmpty = false
): { edits: DayEdit[]; tripLength?: number; lockedDays: { dayNumber: number; names: string[] }[]; lengthRefused: boolean } {
  const current = days.length;
  const max = maxTripDays(days);
  const known = knownPoints(days);
  const byDay = new Map<number, DayEdit>();
  for (const r of raw.edits) {
    if (!r || typeof r !== "object") continue;
    const e = r as Record<string, unknown>;
    const dayNumber = Math.round(num(e.day_number, 0));
    if (dayNumber < 1 || dayNumber > max) continue;
    const activities = (Array.isArray(e.activities) ? e.activities : [])
      .map((x, i) => normalizeActivity(x, i, cur, known))
      .filter((x): x is Activity => x !== null);
    const emptied = allowEmpty && Array.isArray(e.activities) && e.activities.length === 0;
    if (activities.length === 0 && !emptied) continue;
    byDay.set(dayNumber, {
      day_number: dayNumber,
      summary: str(e.summary, ""),
      activities,
      theme: typeof e.theme === "string" && e.theme.trim() ? e.theme : undefined,
      city: typeof e.city === "string" && e.city.trim() ? e.city.trim() : undefined,
    });
  }

  let length = current;
  let lengthRefused = false;
  const wanted = Math.round(num(raw.tripLength, current));
  if (wanted !== current && wanted >= 1 && wanted <= max) {
    const added = Array.from({ length: Math.max(0, wanted - current) }, (_, i) => current + 1 + i);
    const later = new Set((Array.isArray(raw.moreDays) ? raw.moreDays : []).map((n) => Math.round(num(n, 0))));
    const dropped = days.filter((d) => d.day_number > wanted);
    const lockedDrop = dropped.some((d) => lockedActivityNames(d).length > 0);
    if (added.every((n) => byDay.has(n) || later.has(n)) && !lockedDrop) length = wanted;
    else lengthRefused = true;
  }

  const lockedDays: { dayNumber: number; names: string[] }[] = [];
  const edits: DayEdit[] = [];
  for (const edit of [...byDay.values()].sort((a, b) => a.day_number - b.day_number)) {
    if (edit.day_number > length) continue;
    const names = lockedActivityNames(days.find((d) => d.day_number === edit.day_number));
    if (names.length > 0) {
      lockedDays.push({ dayNumber: edit.day_number, names });
      continue;
    }
    edits.push(edit);
  }
  return { edits, tripLength: length !== current ? length : undefined, lockedDays, lengthRefused };
}
