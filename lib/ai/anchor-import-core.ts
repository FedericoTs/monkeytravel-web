/**
 * Paste-a-plan import — PURE normalization core (no I/O, no Gemini imports).
 *
 * F2 of docs/CONSTRAINT_PLANNER_PLAN.md: the traveller pastes a half-made
 * plan ("Day 1 land in Venice, Day 3 wedding in Trieste, Day 5 fly home")
 * and the app fills the gaps instead of replacing the work.
 *
 * F2 is deliberately THIN because F1 already exists: extraction only has to
 * produce a valid `TripAnchor[]`, and lib/ai/anchors-core then does the
 * segmentation/merge/validation that was already built and tested.
 *
 * This module is the trust boundary between messy model output and that
 * machinery. Its ONE hard guarantee:
 *
 *   normalizeImportedAnchors() output ALWAYS passes validateAnchors().
 *
 * That matters because validateAnchors THROWS — if import could emit a
 * conflicting set (two hotels on one night, an out-of-range date, a
 * duplicate id), a paste would 400 and the user would just see a failure
 * with their text lost. So every rule here degrades: bad items are DROPPED
 * with a reason, never propagated, never fatal.
 */
import type { AnchorSlot, AnchorType, TripAnchor } from "@/types";
import {
  MAX_ANCHORS,
  assertISODate,
  inclusiveDaySpan,
} from "./anchors-core";
import { addDaysISO } from "./multi-city-core";

/** One loosely-shaped item as returned by the extraction model. */
export interface RawImportedAnchor {
  /** "2026-09-11" preferred; "day 3" / "3" tolerated (users paste day numbers). */
  date?: unknown;
  title?: unknown;
  type?: unknown;
  location?: unknown;
  /** "morning" | "all day" | "09:40" | "9pm" — all tolerated. */
  time?: unknown;
  notes?: unknown;
}

export interface DroppedImport {
  /** Best-effort label so the UI can say WHICH item was dropped. */
  title: string;
  reason:
    | "no_title"
    | "unparseable_date"
    | "date_out_of_range"
    | "duplicate"
    | "second_lodging_same_night"
    | "over_limit";
}

export interface NormalizedImport {
  anchors: TripAnchor[];
  dropped: DroppedImport[];
}

// ---------------------------------------------------------------------------
// Field coercion
// ---------------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** "day 3", "Day 3:", "d3", or a bare "3" — the most common paste shape. */
const DAY_NUMBER_RE = /^(?:d(?:ay)?\s*)?(\d{1,2})\b/i;
/** "09:40", "9:40", "9.40" */
const HHMM_RE = /^(\d{1,2})[:.](\d{2})$/;
/** "9pm", "10 am" */
const AMPM_RE = /^(\d{1,2})\s*(am|pm)$/i;

const TYPE_SYNONYMS: Array<[RegExp, AnchorType]> = [
  [/\b(flight|fly|plane|airport|train|ferry|bus|drive|transfer|land|depart|arriv)/i, "transport"],
  [/\b(hotel|airbnb|hostel|stay|overnight|sleep|night in|check.?in|accommodation|b&b)/i, "lodging"],
  [/\b(wedding|ceremony|concert|match|game|conference|festival|show|dinner reservation|booked)/i, "event"],
  [/\b(meet|meetup|friends|family|catch up|pick up|see \w+)/i, "meetup"],
];

/** Map a free-text or model-supplied type onto the AnchorType union. */
export function coerceAnchorType(rawType: unknown, title: string): AnchorType {
  const t = typeof rawType === "string" ? rawType.toLowerCase().trim() : "";
  if (t === "transport" || t === "event" || t === "lodging" || t === "meetup" || t === "custom") {
    return t;
  }
  // Fall back to inferring from the type string AND the title — a model that
  // says type:"flight" and a user who wrote "Fly to Venice" should both land
  // on transport.
  const haystack = `${t} ${title}`;
  for (const [re, type] of TYPE_SYNONYMS) {
    if (re.test(haystack)) return type;
  }
  return "custom";
}

/**
 * Resolve a loose date onto the trip range. Returns null when unparseable.
 * Accepts ISO, or a day number relative to the trip start (1-based) — the
 * latter because "Day 1 / Day 2" is how people actually write plans.
 */
export function coerceAnchorDate(
  raw: unknown,
  startDate: string,
  totalDays: number
): string | null {
  if (typeof raw === "number" && Number.isInteger(raw)) {
    return raw >= 1 && raw <= totalDays ? addDaysISO(startDate, raw - 1) : null;
  }
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;

  if (ISO_DATE.test(s)) {
    try {
      assertISODate(s, "imported anchor");
      return s;
    } catch {
      return null; // e.g. 2026-02-30
    }
  }

  const dayMatch = s.match(DAY_NUMBER_RE);
  if (dayMatch) {
    const n = parseInt(dayMatch[1], 10);
    if (n >= 1 && n <= totalDays) return addDaysISO(startDate, n - 1);
    return null;
  }
  return null;
}

/** Split a loose time string into an optional slot + optional HH:MM. */
export function coerceAnchorTime(raw: unknown): {
  slot?: AnchorSlot;
  startTime?: string;
} {
  if (typeof raw !== "string") return {};
  const s = raw.toLowerCase().trim();
  if (!s) return {};

  if (/all.?day|whole day|full day/.test(s)) return { slot: "all_day" };

  const hhmm = s.match(HHMM_RE);
  if (hhmm) {
    const h = parseInt(hhmm[1], 10);
    const m = parseInt(hhmm[2], 10);
    if (h <= 23 && m <= 59) {
      const startTime = `${String(h).padStart(2, "0")}:${hhmm[2]}`;
      return { slot: slotForHour(h), startTime };
    }
  }
  const ampm = s.match(AMPM_RE);
  if (ampm) {
    let h = parseInt(ampm[1], 10);
    if (h <= 12) {
      if (/pm/i.test(ampm[2]) && h !== 12) h += 12;
      if (/am/i.test(ampm[2]) && h === 12) h = 0;
      return { slot: slotForHour(h), startTime: `${String(h).padStart(2, "0")}:00` };
    }
  }
  if (/morning|breakfast/.test(s)) return { slot: "morning" };
  if (/afternoon|lunch|midday/.test(s)) return { slot: "afternoon" };
  if (/evening|night|dinner/.test(s)) return { slot: "evening" };
  return {};
}

function slotForHour(h: number): AnchorSlot {
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}

function cleanText(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\s+/g, " ").trim().slice(0, max);
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Turn raw extraction output into a valid, conflict-free TripAnchor[].
 *
 * Guarantees (all covered by tests):
 *  - every returned anchor sits inside [startDate, endDate]
 *  - ids are unique
 *  - at most ONE lodging per date
 *  - at most MAX_ANCHORS anchors
 *  - the result always passes validateAnchors()
 * Anything that would violate the above is dropped WITH A REASON rather than
 * failing the import — a partial import the user can edit beats an error.
 */
export function normalizeImportedAnchors(
  raw: unknown,
  opts: { startDate: string; endDate: string; idPrefix?: string }
): NormalizedImport {
  const { startDate, endDate } = opts;
  assertISODate(startDate, "trip start");
  assertISODate(endDate, "trip end");
  const totalDays = inclusiveDaySpan(startDate, endDate);
  const prefix = opts.idPrefix ?? "imp";

  const items: RawImportedAnchor[] = Array.isArray(raw) ? raw : [];
  const anchors: TripAnchor[] = [];
  const dropped: DroppedImport[] = [];
  const seenKeys = new Set<string>();
  const lodgingByDate = new Map<string, string>();

  items.forEach((item, i) => {
    const title = cleanText(item?.title, 120);
    if (!title) {
      dropped.push({ title: cleanText(item?.location, 60) || "(untitled)", reason: "no_title" });
      return;
    }

    const date = coerceAnchorDate(item?.date, startDate, totalDays);
    if (!date) {
      dropped.push({ title, reason: "unparseable_date" });
      return;
    }
    if (date < startDate || date > endDate) {
      dropped.push({ title, reason: "date_out_of_range" });
      return;
    }

    const key = `${date}|${title.toLowerCase()}`;
    if (seenKeys.has(key)) {
      dropped.push({ title, reason: "duplicate" });
      return;
    }

    const type = coerceAnchorType(item?.type, title);

    // validateAnchors throws on two lodgings sharing a night — enforce the
    // same rule here so an import can never build a rejectable payload.
    if (type === "lodging") {
      const existing = lodgingByDate.get(date);
      if (existing) {
        dropped.push({ title, reason: "second_lodging_same_night" });
        return;
      }
      lodgingByDate.set(date, title);
    }

    if (anchors.length >= MAX_ANCHORS) {
      dropped.push({ title, reason: "over_limit" });
      return;
    }

    const { slot, startTime } = coerceAnchorTime(item?.time);
    const location = cleanText(item?.location, 160);
    const notes = cleanText(item?.notes, 500);

    seenKeys.add(key);
    anchors.push({
      id: `${prefix}-${i}`,
      date,
      type,
      title,
      // Lodging never carries a slot (anchors-core forces it to "evening").
      ...(type !== "lodging" && slot ? { time_slot: slot } : {}),
      ...(startTime ? { start_time: startTime } : {}),
      ...(location ? { location } : {}),
      ...(notes ? { notes } : {}),
    });
  });

  return { anchors, dropped };
}
