/**
 * Structural-edit intent detection + pure helpers for the trip AI assistant.
 *
 * Transcript evidence (persisted ai_conversations, 2026-07): users
 * systematically ask for STRUCTURAL changes the single-activity tools can't
 * express — "can you add a day to travel to Voss" (the reply claimed a
 * "new Day 12" while the logged action landed on day 1), three different
 * users PASTED entire multi-day draft itineraries ("rearrange as per my own
 * draft", "update all days according to my input"), and "I'd like a 14-day
 * trip". These helpers power the two structural actions built from that
 * evidence: `add_day` (append one day) and `apply_draft` (bulk multi-day
 * revision).
 *
 * Kept pure (no Gemini, no Supabase, no Next imports) so the heuristics are
 * unit-testable — see structural.vitest.ts, same pattern as
 * lib/ai/multi-city-core{,.vitest}.ts.
 */

import type { ItineraryDay, Activity } from "@/types";
import { generateActivityId } from "@/lib/utils/activity-id";

/**
 * Platform-wide trip length ceiling. Matches the generation-side limit
 * (lib/gemini.ts validateTripDuration: "Maximum trip duration is 14 days"
 * and lib/mcp/schema.ts `.max(14)`) — the assistant must not be a side door
 * past it.
 */
export const MAX_TRIP_DAYS = 14;

export type StructuralIntent =
  | {
      type: "add_day";
      /**
       * Present when the user named a target length ("I'd like a 14-day
       * trip"). The handler still appends ONE day at a time — this is used
       * to phrase the reply (and to explain the cap when the target > 14).
       */
      requestedTotalDays?: number;
    }
  | { type: "apply_draft" }
  | { type: "none" };

// ---------------------------------------------------------------------------
// ADD_DAY detection
// ---------------------------------------------------------------------------

// "add a day (to travel to Voss)", "add an extra/another day", "add one more
// day" — but NOT "add a day trip to Versailles" ("day trip" is an excursion
// activity, which the existing single-activity add handles).
const ADD_DAY_PATTERNS: RegExp[] = [
  /\badd\s+(?:an?\s+|one\s+)?(?:extra\s+|more\s+|another\s+|new\s+)?day\b(?!\s*[-\s]?trips?\b)/i,
  /\bone\s+more\s+day\b/i,
  /\bextend\s+(?:my\s+|the\s+|this\s+)?trip\b/i,
  /\bextend\s+(?:it\s+)?by\s+(?:a|one|1)\s+day\b/i,
  // es/it/pt phrasings — the assistant serves all four locales and the
  // draft-paste transcripts show non-English users hit these walls too.
  /\b(?:a[ñn]ade|a[ñn]adir|agrega|agregar|aggiungi|aggiungere|adiciona|adicionar)\s+(?:un\s+|otro\s+|un\s+altro\s+|um\s+|mais\s+um\s+)?(?:d[ií]a|giorno|dia)\b/i,
];

// "I'd like a 14-day trip", "make it a 10 day trip", "extend to 12 days".
// Desire verb + explicit length → add_day with requestedTotalDays metadata.
// The (?<!\bby\s) lookbehind keeps "extend my trip by 2 days" from being
// misread as a 2-day TARGET (it's a relative extension → plain add_day).
const DESIRED_LENGTH_PATTERN =
  /\b(?:want|like|make|turn|extend|prefer)\b[^.\n]{0,40}?(?<!\bby\s)\b(\d{1,2})\s*[-\s]\s*days?\b/i;

// ---------------------------------------------------------------------------
// APPLY_DRAFT detection
// ---------------------------------------------------------------------------

// Day markers in en/es/it/pt: "Day 3", "Día 3", "Giorno 3", "Dia 3".
const DAY_MARKER_RE = /\b(?:day|d[ií]a|giorno|dia)\s*(\d{1,2})\b/gi;

// Lines that open with a weekday followed by something date-like
// ("Monday 12 May", "Sat, May 12", "lunes 3", "sabato 12 giugno", …).
const WEEKDAY_DATE_LINE_RE =
  /^\s*(?:mon|tue(?:s)?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?\b[\s,.:–-]*(?:\d{1,2}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;
const WEEKDAY_DATE_LINE_INTL_RE =
  /^\s*(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato|domenica|segunda|ter[cç]a|quarta|quinta|sexta)\b[\s,.:–-]*\d{0,2}/i;

// "rearrange as per my own draft", "update all days according to my input",
// "follow this plan" (+ es/it/pt equivalents).
const DRAFT_INSTRUCTION_RE =
  /\b(?:rearrange|re-arrange|reorganiz\w*|restructure|update\s+all(?:\s+the)?\s+days|change\s+all(?:\s+the)?\s+days|as\s+per\s+my|according\s+to\s+my|follow\s+(?:this|my)|use\s+(?:this|my)\s+(?:draft|plan|itinerary|schedule)|(?:my|this)\s+(?:own\s+)?draft|reorganiza|actualiza\s+todos\s+los\s+d[ií]as|seg[uú]n\s+mi|aggiorna\s+tutti\s+i\s+giorni|secondo\s+il\s+mio|segui\s+quest|atualiz[ae]\s+todos\s+os\s+dias|conforme\s+(?:o\s+)?meu)\b/i;

// Lettered list items: "A. Colosseum", "b) Trastevere dinner", …
const LETTER_LIST_LINE_RE = /^\s*[A-Ha-h][.)]\s+\S/;

/**
 * True when the message reads like a pasted multi-day plan (rather than a
 * question that merely mentions days). Deliberately also catches short
 * cross-day rearrangements ("rearrange day 1 and day 2") — moving content
 * BETWEEN days is exactly what the single-day tools can't do, and the
 * mapping prompt is instructed to return no days when the message turns out
 * not to contain an actionable plan.
 */
export function detectDraftPaste(message: string): boolean {
  const lines = message.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const dayMarkers = new Set(
    Array.from(message.matchAll(DAY_MARKER_RE), (m) => m[1])
  );
  const weekdayDateLines = lines.filter(
    (l) => WEEKDAY_DATE_LINE_RE.test(l) || WEEKDAY_DATE_LINE_INTL_RE.test(l)
  ).length;
  const letterListLines = lines.filter((l) =>
    LETTER_LIST_LINE_RE.test(l)
  ).length;
  const hasInstruction = DRAFT_INSTRUCTION_RE.test(message);

  // 3+ distinct day markers = unambiguous pasted plan.
  if (dayMarkers.size >= 3) return true;
  // 2 day markers need corroboration: multi-line structure or an explicit
  // "use my draft"-style instruction (guards "swap day 1 and day 2"-class
  // questions from being treated as drafts).
  if (dayMarkers.size >= 2 && (lines.length >= 4 || hasInstruction)) {
    return true;
  }
  if (weekdayDateLines >= 2 && (lines.length >= 4 || hasInstruction)) {
    return true;
  }
  // A./B./C. lists are only a draft when paired with an instruction.
  if (letterListLines >= 3 && hasInstruction) return true;
  return false;
}

/**
 * Detect structural intents. Must run BEFORE detectActionIntent(): the
 * legacy "simple add detection" (`lowerMsg.includes("add ")`) is what
 * swallowed "can you add a day to travel to Voss" and landed the action on
 * day 1 (transcript, 2026-07).
 */
export function detectStructuralIntent(message: string): StructuralIntent {
  // Draft paste first — it's the most specific signal, and a pasted plan
  // frequently contains the word "add" somewhere in it.
  if (detectDraftPaste(message)) {
    return { type: "apply_draft" };
  }

  for (const pattern of ADD_DAY_PATTERNS) {
    if (pattern.test(message)) {
      const desired = message.match(DESIRED_LENGTH_PATTERN);
      return {
        type: "add_day",
        requestedTotalDays: desired ? parseInt(desired[1], 10) : undefined,
      };
    }
  }

  // "I'd like a 14-day trip" — no literal "add a day", but a named target
  // length with a desire verb is an extend request.
  const desired = message.match(DESIRED_LENGTH_PATTERN);
  if (desired) {
    return { type: "add_day", requestedTotalDays: parseInt(desired[1], 10) };
  }

  return { type: "none" };
}

// ---------------------------------------------------------------------------
// Date helpers (trips.start_date / end_date and ItineraryDay.date are
// YYYY-MM-DD strings — see lib/trips/persistTrip.ts)
// ---------------------------------------------------------------------------

function toISODate(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return null;
  const d = new Date(`${candidate}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : candidate;
}

/**
 * The day AFTER the first parseable date in `candidates` (YYYY-MM-DD), or
 * null when none parse. Used to date an appended day from the last
 * itinerary day (fallback: the trip's end_date).
 */
export function nextDateISO(
  candidates: Array<string | null | undefined>
): string | null {
  for (const candidate of candidates) {
    const iso = toISODate(candidate);
    if (iso) {
      const d = new Date(`${iso}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      return d.toISOString().slice(0, 10);
    }
  }
  return null;
}

/**
 * New trips.end_date after appending a day dated `appendedDate`, or null
 * when no update is needed (stored end_date already covers it). String
 * compare is safe on normalized YYYY-MM-DD.
 */
export function computeExtendedEndDate(
  currentEndDate: string | null | undefined,
  appendedDate: string
): string | null {
  const appended = toISODate(appendedDate);
  if (!appended) return null;
  const current = toISODate(currentEndDate);
  if (current && current >= appended) return null;
  return appended;
}

// ---------------------------------------------------------------------------
// Draft-day normalization (post-processing of the mapping model's output)
// ---------------------------------------------------------------------------

const MAX_ACTIVITIES_PER_DAY = 8;

export interface NormalizedDraft {
  /** Revised days, in trip order, ready to splice over the current ones. */
  days: ItineraryDay[];
  changedDayNumbers: number[];
  /** Current day numbers the draft did NOT cover — they stay untouched. */
  unmappedDayNumbers: number[];
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function normalizeActivity(
  raw: Record<string, unknown>,
  existingByName: Map<string, Activity>
): Activity | null {
  const name = asString(raw.name).trim();
  if (!name) return null;

  // Re-link to the stored activity when the draft kept it: carries over the
  // id (drag/edit code paths key on it), coordinates, image and booking
  // fields instead of trusting the model to echo them.
  const existing = existingByName.get(name.toLowerCase());

  const startTime = asString(raw.start_time, existing?.start_time || "10:00");
  const hours = parseInt(startTime.split(":")[0] || "10", 10);
  const timeSlot: Activity["time_slot"] =
    hours < 12 ? "morning" : hours < 17 ? "afternoon" : "evening";

  const duration = Number(raw.duration_minutes);
  const rawCost = (raw.estimated_cost ?? {}) as Record<string, unknown>;

  return {
    ...(existing ?? {}),
    id: existing?.id || generateActivityId(),
    name,
    type: asString(raw.type, existing?.type || "activity"),
    description: asString(raw.description, existing?.description || ""),
    location: asString(raw.location, existing?.location || ""),
    address: asString(raw.address, existing?.address || "") || undefined,
    start_time: startTime,
    time_slot: timeSlot,
    duration_minutes:
      Number.isFinite(duration) && duration > 0
        ? Math.round(duration)
        : existing?.duration_minutes || 90,
    coordinates: existing?.coordinates ?? (raw.coordinates as Activity["coordinates"]),
    estimated_cost: existing?.estimated_cost ?? {
      amount: Number(rawCost.amount) || 0,
      currency: asString(rawCost.currency, "EUR"),
      tier:
        (asString(rawCost.tier) as Activity["estimated_cost"]["tier"]) ||
        "moderate",
    },
    tips: Array.isArray(raw.tips)
      ? (raw.tips as unknown[]).filter((t): t is string => typeof t === "string")
      : existing?.tips || [],
    booking_required:
      typeof raw.booking_required === "boolean"
        ? raw.booking_required
        : existing?.booking_required || false,
  };
}

/**
 * Validate + normalize the mapping model's revised days against the CURRENT
 * itinerary. Guarantees:
 * - only existing day_numbers survive (no length change — that's add_day's
 *   job), each at most once, returned in trip order;
 * - date and city are forced from the stored day (multi-city trips must not
 *   have their per-day city drift);
 * - every activity has an id (existing carried over by name, else a fresh
 *   generateActivityId());
 * - activity count per day is bounded.
 * Coordinates are NOT resolved here — the route runs the returned days
 * through lib/gemini's validateAndFixCoordinates (needs the destination).
 */
export function normalizeDraftDays(
  rawDays: unknown,
  currentItinerary: ItineraryDay[]
): NormalizedDraft {
  const currentByNumber = new Map(
    currentItinerary.map((d) => [d.day_number, d])
  );
  const existingByName = new Map<string, Activity>();
  for (const day of currentItinerary) {
    for (const activity of day.activities) {
      existingByName.set(activity.name.toLowerCase(), activity);
    }
  }

  const revisedByNumber = new Map<number, ItineraryDay>();

  if (Array.isArray(rawDays)) {
    for (const raw of rawDays as Array<Record<string, unknown>>) {
      if (!raw || typeof raw !== "object") continue;
      const dayNumber = Number(raw.day_number);
      const current = currentByNumber.get(dayNumber);
      if (!current || revisedByNumber.has(dayNumber)) continue;

      const activities = (Array.isArray(raw.activities) ? raw.activities : [])
        .slice(0, MAX_ACTIVITIES_PER_DAY)
        .map((a) =>
          normalizeActivity((a ?? {}) as Record<string, unknown>, existingByName)
        )
        .filter((a): a is Activity => a !== null);
      if (activities.length === 0) continue;

      revisedByNumber.set(dayNumber, {
        ...current,
        day_number: current.day_number,
        date: current.date, // identity fields stay pinned to the stored day
        city: current.city,
        theme: asString(raw.theme, current.theme || "") || current.theme,
        activities,
      });
    }
  }

  const changedDayNumbers = Array.from(revisedByNumber.keys()).sort(
    (a, b) => a - b
  );
  return {
    days: changedDayNumbers.map((n) => revisedByNumber.get(n)!),
    changedDayNumbers,
    unmappedDayNumbers: currentItinerary
      .map((d) => d.day_number)
      .filter((n) => !revisedByNumber.has(n)),
  };
}
