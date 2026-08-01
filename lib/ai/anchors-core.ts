/**
 * Anchored-trip planning — PURE core (no I/O, no Gemini imports).
 *
 * F1-A of the constraint planner (docs/CONSTRAINT_PLANNER_PLAN.md): the user
 * declares fixed commitments ("anchors" — flights, weddings, nights that must
 * end in a specific town) and the planner fills the gaps AROUND them instead
 * of offering its own trip.
 *
 * Architecture mirrors multi-city (multi-city-core.ts): every piece of
 * constraint logic is DETERMINISTIC and lives here, fully unit-tested. The
 * LLM only ever fills one unconstrained gap ("segment") with local context —
 * it NEVER does global constraint satisfaction. The orchestrator that calls
 * Gemini lives in lib/ai/anchored.ts.
 *
 * COST INVARIANT (plan §6, BINDING): this module makes exactly ZERO Google
 * API calls. All geometry is haversine over coordinates Gemini already
 * returns for free. Distance Matrix / Routes are banned from the solver.
 */
import type {
  Activity,
  AnchorSlot,
  GeneratedItinerary,
  ItineraryDay,
  TimeSlot,
  TripAnchor,
} from "@/types";
import { addDaysISO } from "./multi-city-core";

/** Max anchors per trip in v1 (keeps segmentation + prompts sane). */
export const MAX_ANCHORS = 20;

/** Max trip length the anchored planner accepts (matches app-wide caps). */
export const MAX_ANCHORED_TRIP_DAYS = 30;

/**
 * "End the day near X" tolerance. Loose on purpose: Venice→Prosecco hills is
 * a normal day trip (~55km); Venice→Trieste (~115km) is not "near Trieste".
 */
export const DEFAULT_END_NEAR_KM = 60;

export class AnchorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnchorError";
  }
}

// Strict ISO first, then strict parse — the lenient `new Date("20220-08-11")`
// path is exactly the 1J prod bug (see lib/ai/trip-date-validation.vitest.ts).
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ANCHOR_ID = /^[A-Za-z0-9_-]{1,64}$/;

const ANCHOR_TYPES = new Set(["transport", "event", "lodging", "meetup", "custom"]);
const ANCHOR_SLOTS = new Set(["morning", "afternoon", "evening", "all_day"]);

/** Throws AnchorError unless `date` is a real YYYY-MM-DD calendar date. */
export function assertISODate(date: string, label: string): void {
  if (typeof date !== "string" || !ISO_DATE.test(date)) {
    throw new AnchorError(`${label}: date must be YYYY-MM-DD (got "${date}")`);
  }
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new AnchorError(`${label}: "${date}" is not a valid calendar date`);
  }
}

/** Whole days from a to b inclusive of both ends (a === b ⇒ 1). */
export function inclusiveDaySpan(startISO: string, endISO: string): number {
  const a = new Date(`${startISO}T00:00:00Z`).getTime();
  const b = new Date(`${endISO}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000) + 1;
}

/**
 * The slot an anchor effectively occupies. Lodging is ALWAYS "evening"
 * (it never locks a day — it constrains where the day ends); everything
 * else defaults to "all_day" when unspecified, because "I have a thing
 * that day" most safely means "don't plan over any of it".
 */
export function effectiveSlot(anchor: TripAnchor): AnchorSlot {
  if (anchor.type === "lodging") return "evening";
  return anchor.time_slot ?? "all_day";
}

/** Sort order for anchors within a day: all-day first, then by daypart. */
const anchorSlotOrder: Record<AnchorSlot, number> = {
  all_day: 0,
  morning: 1,
  afternoon: 2,
  evening: 3,
};

/** Sort order for merged activities within a day. */
const activitySlotOrder: Record<TimeSlot, number> = {
  morning: 0,
  afternoon: 1,
  evening: 2,
};

/**
 * Validate anchors against the trip range. Throws AnchorError on the first
 * problem — the API route maps it to a 400.
 */
export function validateAnchors(
  startDate: string,
  endDate: string,
  anchors: TripAnchor[]
): void {
  assertISODate(startDate, "trip start");
  assertISODate(endDate, "trip end");
  if (endDate < startDate) {
    throw new AnchorError(`trip end (${endDate}) is before trip start (${startDate})`);
  }
  const totalDays = inclusiveDaySpan(startDate, endDate);
  if (totalDays > MAX_ANCHORED_TRIP_DAYS) {
    throw new AnchorError(
      `anchored trips support at most ${MAX_ANCHORED_TRIP_DAYS} days (got ${totalDays})`
    );
  }
  if (!Array.isArray(anchors) || anchors.length === 0) {
    throw new AnchorError("at least one anchor is required");
  }
  if (anchors.length > MAX_ANCHORS) {
    throw new AnchorError(`a trip can have at most ${MAX_ANCHORS} anchors (got ${anchors.length})`);
  }

  const seenIds = new Set<string>();
  const lodgingDates = new Map<string, string>(); // date → anchor title
  for (const a of anchors) {
    if (typeof a.id !== "string" || !ANCHOR_ID.test(a.id)) {
      throw new AnchorError(`anchor id "${a.id}" must be 1-64 chars of [A-Za-z0-9_-]`);
    }
    if (seenIds.has(a.id)) throw new AnchorError(`duplicate anchor id "${a.id}"`);
    seenIds.add(a.id);

    if (!ANCHOR_TYPES.has(a.type)) {
      throw new AnchorError(`anchor "${a.id}": unknown type "${a.type}"`);
    }
    assertISODate(a.date, `anchor "${a.id}"`);
    if (a.date < startDate || a.date > endDate) {
      throw new AnchorError(
        `anchor "${a.id}" (${a.date}) falls outside the trip (${startDate} to ${endDate})`
      );
    }
    if (typeof a.title !== "string" || !a.title.trim()) {
      throw new AnchorError(`anchor "${a.id}" needs a title`);
    }
    if (a.title.length > 120) throw new AnchorError(`anchor "${a.id}": title over 120 chars`);
    if (a.location !== undefined && a.location.length > 160) {
      throw new AnchorError(`anchor "${a.id}": location over 160 chars`);
    }
    if (a.notes !== undefined && a.notes.length > 500) {
      throw new AnchorError(`anchor "${a.id}": notes over 500 chars`);
    }
    if (a.time_slot !== undefined && !ANCHOR_SLOTS.has(a.time_slot)) {
      throw new AnchorError(`anchor "${a.id}": invalid time_slot "${a.time_slot}"`);
    }
    if (a.start_time !== undefined && !HHMM.test(a.start_time)) {
      throw new AnchorError(`anchor "${a.id}": start_time must be HH:MM (got "${a.start_time}")`);
    }
    if (a.place !== undefined) {
      const { lat, lng } = a.place;
      if (
        !Number.isFinite(lat) || !Number.isFinite(lng) ||
        lat < -90 || lat > 90 || lng < -180 || lng > 180
      ) {
        throw new AnchorError(`anchor "${a.id}": place coordinates out of range`);
      }
    }
    if (a.type === "lodging") {
      const clash = lodgingDates.get(a.date);
      if (clash) {
        throw new AnchorError(
          `two overnight stays on ${a.date} ("${clash}" and "${a.title}") — a night can only end in one place`
        );
      }
      lodgingDates.set(a.date, a.title);
    }
  }
}

// ============================================================================
// LAYOUT + SEGMENTATION
// ============================================================================

/** A resolved "near X" reference for prompt context + haversine checks. */
export interface AnchorPlaceRef {
  label: string;
  lat?: number;
  lng?: number;
}

export interface LayoutDay {
  date: string;
  /** 1-based global day number. */
  dayNumber: number;
  /**
   * locked  — an all-day commitment owns the day; the generator skips it.
   * partial — some slots are anchored; the generator fills the rest.
   * free    — fully open.
   */
  kind: "locked" | "partial" | "free";
  /** Anchors on this day, sorted all-day → morning → afternoon → evening. */
  anchors: TripAnchor[];
  /** Slots still open for the generator (empty for locked days). */
  freeSlots: TimeSlot[];
  /** Where this day must END (from a lodging anchor), if constrained. */
  endNear?: AnchorPlaceRef;
  /** Segment membership for non-locked days. */
  segmentIndex?: number;
  segmentDayIndex?: number;
}

/** A maximal run of consecutive non-locked days the LLM fills as one unit. */
export interface TripSegment {
  index: number;
  startDate: string;
  endDate: string;
  days: LayoutDay[];
  /** Where the traveller comes from entering this stretch (context, soft). */
  startNear?: AnchorPlaceRef;
  /** Where the final day must end (hard-ish; haversine-checked post-merge). */
  mustEndNear?: AnchorPlaceRef;
  /** Human reason ("Night in Trieste", "Wedding") for the prompt. */
  mustEndReason?: string;
}

export interface AnchorLayout {
  startDate: string;
  endDate: string;
  totalDays: number;
  days: LayoutDay[];
  segments: TripSegment[];
}

function hasPlaceRef(a: TripAnchor): boolean {
  return Boolean((a.location && a.location.trim()) || a.place);
}

function toPlaceRef(a: TripAnchor): AnchorPlaceRef {
  return {
    label: a.location?.trim() || a.title,
    lat: a.place?.lat,
    lng: a.place?.lng,
  };
}

function sortAnchorsForDay(anchors: TripAnchor[]): TripAnchor[] {
  return [...anchors].sort((x, y) => {
    const so = anchorSlotOrder[effectiveSlot(x)] - anchorSlotOrder[effectiveSlot(y)];
    if (so !== 0) return so;
    return (x.start_time ?? "").localeCompare(y.start_time ?? "");
  });
}

/**
 * Deterministically decompose the trip into locked/partial/free days and
 * contiguous fillable segments, resolving each segment's geographic context
 * (startNear) and end constraint (mustEndNear).
 */
export function segmentTrip(
  startDate: string,
  endDate: string,
  anchors: TripAnchor[]
): AnchorLayout {
  validateAnchors(startDate, endDate, anchors);
  const totalDays = inclusiveDaySpan(startDate, endDate);

  const byDate = new Map<string, TripAnchor[]>();
  for (const a of anchors) {
    const list = byDate.get(a.date) ?? [];
    list.push(a);
    byDate.set(a.date, list);
  }

  const days: LayoutDay[] = [];
  for (let i = 0; i < totalDays; i++) {
    const date = addDaysISO(startDate, i);
    const dayAnchors = sortAnchorsForDay(byDate.get(date) ?? []);
    const nonLodging = dayAnchors.filter((a) => a.type !== "lodging");
    const occupied = new Set<TimeSlot>();
    let allDayLock = false;
    for (const a of nonLodging) {
      const slot = effectiveSlot(a);
      if (slot === "all_day") allDayLock = true;
      else occupied.add(slot);
    }
    const freeSlots = allDayLock
      ? []
      : (["morning", "afternoon", "evening"] as TimeSlot[]).filter((s) => !occupied.has(s));
    const locked = allDayLock || (nonLodging.length > 0 && freeSlots.length === 0);
    const lodging = dayAnchors.find((a) => a.type === "lodging" && hasPlaceRef(a));
    days.push({
      date,
      dayNumber: i + 1,
      kind: locked ? "locked" : dayAnchors.length > 0 ? "partial" : "free",
      anchors: dayAnchors,
      freeSlots: locked ? [] : freeSlots,
      endNear: lodging ? toPlaceRef(lodging) : undefined,
    });
  }

  // Segments = maximal runs of non-locked days.
  const segments: TripSegment[] = [];
  let run: LayoutDay[] = [];
  const flush = () => {
    if (run.length === 0) return;
    const index = segments.length;
    run.forEach((d, i) => {
      d.segmentIndex = index;
      d.segmentDayIndex = i;
    });
    segments.push({
      index,
      startDate: run[0].date,
      endDate: run[run.length - 1].date,
      days: run,
      startNear: resolveStartNear(days, run[0]),
      ...resolveMustEnd(days, run[run.length - 1]),
    });
    run = [];
  };
  for (const day of days) {
    if (day.kind === "locked") flush();
    else run.push(day);
  }
  flush();

  return { startDate, endDate, totalDays, days, segments };
}

/**
 * Where does the traveller come FROM entering this segment?
 * Priority: a located morning arrival on the segment's own first day
 * ("Land at VCE 09:40") → where they slept the previous night → the last
 * located commitment on any earlier day.
 */
function resolveStartNear(days: LayoutDay[], first: LayoutDay): AnchorPlaceRef | undefined {
  const morningArrival = first.anchors.find(
    (a) => a.type !== "lodging" && effectiveSlot(a) === "morning" && hasPlaceRef(a)
  );
  if (morningArrival) return toPlaceRef(morningArrival);
  for (let i = first.dayNumber - 2; i >= 0; i--) {
    const d = days[i];
    if (d.endNear) return d.endNear;
    const located = [...d.anchors].reverse().find(hasPlaceRef);
    if (located) return toPlaceRef(located);
  }
  return undefined;
}

/**
 * Where must the segment's final day END?
 * A lodging anchor on the last day wins ("Night in Trieste"); otherwise the
 * first located commitment on the locked day that terminated the segment
 * (be in Trieste tonight because the wedding is there tomorrow).
 */
function resolveMustEnd(
  days: LayoutDay[],
  last: LayoutDay
): { mustEndNear?: AnchorPlaceRef; mustEndReason?: string } {
  if (last.endNear) {
    const lodging = last.anchors.find((a) => a.type === "lodging" && hasPlaceRef(a));
    return { mustEndNear: last.endNear, mustEndReason: lodging?.title };
  }
  const next = days[last.dayNumber]; // dayNumber is 1-based ⇒ this is the following day
  if (next && next.kind === "locked") {
    const located = next.anchors.find(hasPlaceRef);
    if (located) {
      return { mustEndNear: toPlaceRef(located), mustEndReason: located.title };
    }
  }
  return {};
}

// ============================================================================
// PROMPT BRIEF (deterministic — unit-tested here, injected by lib/ai/anchored)
// ============================================================================

/**
 * The per-segment constraint brief appended to the generation prompt.
 * English on purpose: it is model-facing instruction text, not user copy
 * (the itinerary language is controlled separately by options.language).
 */
export function buildSegmentBrief(seg: TripSegment, totalDays: number): string {
  const first = seg.days[0];
  const last = seg.days[seg.days.length - 1];
  const lines: string[] = [];
  lines.push(
    `This request covers days ${first.dayNumber}-${last.dayNumber} of a ${totalDays}-day trip: generate exactly ${seg.days.length} day(s), dated ${seg.startDate} to ${seg.endDate}.`
  );
  if (seg.startNear) {
    lines.push(`The traveller starts this stretch near ${seg.startNear.label}.`);
  }
  if (seg.mustEndNear) {
    lines.push(
      `HARD CONSTRAINT: the final day (${seg.endDate}) must END in or near ${seg.mustEndNear.label}` +
        `${seg.mustEndReason ? ` (${seg.mustEndReason})` : ""}. Put that day's last activities there or within a short drive.`
    );
  }
  const commitments = seg.days.flatMap((d) => d.anchors.map((a) => ({ d, a })));
  if (commitments.length > 0) {
    lines.push(
      "Already-booked commitments in this stretch. Do NOT schedule anything overlapping them and do NOT include them in your JSON output (they are added automatically):"
    );
    for (const { d, a } of commitments) {
      const slot = effectiveSlot(a);
      const when = a.start_time ? `${slot} ${a.start_time}` : slot;
      lines.push(
        `- ${d.date} (${when}): ${a.title}` +
          `${a.location ? ` — ${a.location}` : ""}` +
          `${a.type === "lodging" ? " [overnight stay: end this day near here]" : ""}`
      );
    }
  }
  for (const d of seg.days) {
    if (d.kind === "partial" && d.freeSlots.length > 0 && d.freeSlots.length < 3) {
      lines.push(`On ${d.date} only plan the ${d.freeSlots.join(" and ")} slot(s).`);
    }
  }
  return lines.join("\n");
}

// ============================================================================
// MATERIALIZATION + MERGE
// ============================================================================

const SLOT_DEFAULT_START: Record<AnchorSlot, string> = {
  morning: "09:00",
  afternoon: "14:00",
  evening: "19:00",
  all_day: "09:00",
};

const ANCHOR_ACTIVITY_TYPE: Record<TripAnchor["type"], string> = {
  transport: "transport",
  event: "event",
  lodging: "lodging",
  meetup: "event",
  custom: "activity",
};

/** Materialize an anchor as a locked, zero-cost activity. */
export function anchorToActivity(anchor: TripAnchor, currency: string): Activity {
  const slot = effectiveSlot(anchor);
  const timeSlot: TimeSlot = slot === "all_day" ? "morning" : slot;
  const isLodging = anchor.type === "lodging";
  return {
    id: `anchor-${anchor.id}`,
    time_slot: timeSlot,
    // Lodging defaults late so it sorts after dinner, not before it.
    start_time: anchor.start_time ?? (isLodging ? "21:00" : SLOT_DEFAULT_START[slot]),
    duration_minutes: slot === "all_day" ? 480 : isLodging ? 60 : 120,
    name: anchor.title,
    type: ANCHOR_ACTIVITY_TYPE[anchor.type],
    description: anchor.notes ?? "",
    location: anchor.location ?? "",
    coordinates: anchor.place ? { lat: anchor.place.lat, lng: anchor.place.lng } : undefined,
    google_place_id: anchor.place?.place_id,
    estimated_cost: { amount: 0, currency, tier: "free" },
    tips: [],
    booking_required: false,
    locked: true,
    anchor_id: anchor.id,
  };
}

function sortDayActivities(activities: Activity[]): Activity[] {
  return [...activities].sort((a, b) => {
    const so = (activitySlotOrder[a.time_slot] ?? 0) - (activitySlotOrder[b.time_slot] ?? 0);
    if (so !== 0) return so;
    return (a.start_time ?? "").localeCompare(b.start_time ?? "");
  });
}

/** Build a locked day purely from its anchors (no LLM involved — $0). */
export function buildLockedDay(day: LayoutDay, currency: string): ItineraryDay {
  return {
    day_number: day.dayNumber,
    date: day.date,
    title: day.anchors[0]?.title,
    activities: sortDayActivities(day.anchors.map((a) => anchorToActivity(a, currency))),
  };
}

export interface AnchoredMergeOptions {
  /** Display label for the trip destination (params.destination). */
  destinationLabel: string;
  /** Currency for anchor activities; defaults to the first result's. */
  currency?: string;
}

function dedupeStrings(arr: string[]): string[] {
  return Array.from(new Set(arr.map((s) => s.trim()).filter(Boolean)));
}

/**
 * Stitch locked days + per-segment LLM results into ONE itinerary.
 * Philosophy matches multi-city: a usable trip beats a hard fail — shape
 * problems become `issues` strings (observability), not thrown errors,
 * except for a caller bug (result count ≠ segment count).
 */
export function mergeAnchoredItinerary(
  layout: AnchorLayout,
  segmentResults: GeneratedItinerary[],
  opts: AnchoredMergeOptions
): { itinerary: GeneratedItinerary; issues: string[] } {
  if (segmentResults.length !== layout.segments.length) {
    throw new AnchorError(
      `mergeAnchoredItinerary: ${layout.segments.length} segments but ${segmentResults.length} results`
    );
  }
  const issues: string[] = [];
  const currency =
    opts.currency ?? segmentResults[0]?.trip_summary?.currency ?? "USD";

  // Primary result (for destination block + booking links): longest segment.
  let primary: GeneratedItinerary | undefined;
  let primaryLen = -1;
  layout.segments.forEach((seg, i) => {
    if (seg.days.length > primaryLen) {
      primaryLen = seg.days.length;
      primary = segmentResults[i];
    }
  });

  const mergedDays: ItineraryDay[] = layout.days.map((day) => {
    if (day.kind === "locked") return buildLockedDay(day, currency);

    const res = segmentResults[day.segmentIndex!];
    const llmDay = res?.days?.[day.segmentDayIndex!];
    const anchorActivities = day.anchors.map((a) => anchorToActivity(a, currency));

    if (!llmDay) {
      issues.push(
        `segment ${day.segmentIndex! + 1} returned no day for ${day.date} — kept as a light day`
      );
      return {
        day_number: day.dayNumber,
        date: day.date,
        activities: sortDayActivities(anchorActivities),
      };
    }

    // Belt-and-braces: the brief told the model to leave anchored slots
    // empty AND not to re-emit the commitments — drop anything that ignored
    // either rule so anchors stay the single source of truth.
    const anchoredSlots = new Set<TimeSlot>(
      day.anchors
        .filter((a) => a.type !== "lodging")
        .map((a) => effectiveSlot(a))
        .filter((s): s is TimeSlot => s !== "all_day")
    );
    const kept = (llmDay.activities ?? []).filter((act) => !anchoredSlots.has(act.time_slot));
    const droppedCount = (llmDay.activities ?? []).length - kept.length;
    if (droppedCount > 0) {
      issues.push(
        `dropped ${droppedCount} generated activit${droppedCount === 1 ? "y" : "ies"} overlapping anchored slots on ${day.date}`
      );
    }

    return {
      ...llmDay,
      day_number: day.dayNumber,
      date: day.date,
      activities: sortDayActivities([...kept, ...anchorActivities]),
    };
  });

  const itinerary: GeneratedItinerary = {
    destination: {
      name: primary?.destination?.name || opts.destinationLabel,
      country: primary?.destination?.country ?? "",
      description: primary?.destination?.description ?? "",
      best_for: dedupeStrings(segmentResults.flatMap((r) => r.destination?.best_for ?? [])),
      weather_note: primary?.destination?.weather_note ?? "",
    },
    days: mergedDays,
    trip_summary: {
      total_estimated_cost: segmentResults.reduce(
        (sum, r) => sum + (r.trip_summary?.total_estimated_cost ?? 0),
        0
      ),
      currency,
      highlights: segmentResults.flatMap((r) => r.trip_summary?.highlights ?? []),
      packing_suggestions: dedupeStrings(
        segmentResults.flatMap((r) => r.trip_summary?.packing_suggestions ?? [])
      ),
    },
    booking_links: primary?.booking_links
      ? {
          flights: primary.booking_links.flights ?? [],
          hotels: segmentResults.flatMap((r) => r.booking_links?.hotels ?? []),
        }
      : undefined,
  };

  return { itinerary, issues };
}

// ============================================================================
// POST-MERGE VALIDATION ($0 — haversine only)
// ============================================================================

/** Great-circle distance in km. */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Soft validation of the merged trip against the layout: anchor integrity
 * (every anchor exactly once, on its date, locked) + geographic end-of-day
 * constraints via haversine. Returns human-readable issues; never throws.
 */
export function validateMergedItinerary(
  layout: AnchorLayout,
  itinerary: GeneratedItinerary,
  opts?: { maxEndNearKm?: number }
): string[] {
  const issues: string[] = [];
  const maxKm = opts?.maxEndNearKm ?? DEFAULT_END_NEAR_KM;

  if (itinerary.days.length !== layout.totalDays) {
    issues.push(`expected ${layout.totalDays} days, got ${itinerary.days.length}`);
  }

  // Anchor integrity.
  const seen = new Map<string, string[]>(); // anchor_id → dates it appears on
  for (const day of itinerary.days) {
    for (const act of day.activities ?? []) {
      if (act.anchor_id) {
        const dates = seen.get(act.anchor_id) ?? [];
        dates.push(day.date);
        seen.set(act.anchor_id, dates);
      }
    }
  }
  for (const day of layout.days) {
    for (const anchor of day.anchors) {
      const dates = seen.get(anchor.id);
      if (!dates || dates.length === 0) {
        issues.push(`anchor "${anchor.title}" (${anchor.id}) missing from the merged trip`);
      } else if (dates.length > 1) {
        issues.push(`anchor "${anchor.title}" (${anchor.id}) appears ${dates.length} times`);
      } else if (dates[0] !== anchor.date) {
        issues.push(
          `anchor "${anchor.title}" (${anchor.id}) landed on ${dates[0]} instead of ${anchor.date}`
        );
      }
    }
  }

  // End-of-day geography: per-day lodging constraints + segment end constraints.
  const checkEnd = (date: string, ref: AnchorPlaceRef, reason: string | undefined) => {
    if (ref.lat === undefined || ref.lng === undefined) return; // no coords ⇒ unverifiable
    const day = itinerary.days.find((d) => d.date === date);
    if (!day) return;
    const locatedLlm = [...(day.activities ?? [])]
      .reverse()
      .find((a) => !a.locked && a.coordinates);
    if (!locatedLlm?.coordinates) return; // nothing verifiable
    const km = haversineKm(ref.lat, ref.lng, locatedLlm.coordinates.lat, locatedLlm.coordinates.lng);
    if (km > maxKm) {
      issues.push(
        `${date} should end near ${ref.label}${reason ? ` (${reason})` : ""} but its last located activity ("${locatedLlm.name}") is ${Math.round(km)}km away`
      );
    }
  };
  const checkedDates = new Set<string>();
  for (const day of layout.days) {
    if (day.endNear) {
      checkEnd(day.date, day.endNear, undefined);
      checkedDates.add(day.date);
    }
  }
  for (const seg of layout.segments) {
    if (seg.mustEndNear && !checkedDates.has(seg.endDate)) {
      checkEnd(seg.endDate, seg.mustEndNear, seg.mustEndReason);
    }
  }

  return issues;
}
