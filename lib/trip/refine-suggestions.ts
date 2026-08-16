/**
 * Itinerary-derived refine suggestions for the result-page assistant.
 *
 * WHY THIS EXISTS (2026-08-01 funnel read): 78% of result-viewers generate
 * exactly once and convert at 9.7%, while sessions that generate 3+ times
 * convert at 26.3%. Making the plan yours is what precedes keeping it. The
 * assistant, its inline placement AND static suggestion chips were all already
 * shipped — and result→save_clicked still didn't move (24.9% → 24.7%). The one
 * thing never tried is making the prompt about THIS trip instead of any trip:
 * "Make day 1 more relaxed" is wallpaper; "Day 3 has 6 stops — lighten it?"
 * is an observation about your plan.
 *
 * Pure and dependency-free so it can be unit-tested against real itineraries.
 * Returns i18n descriptors, never prose — the panel renders them.
 */
import type { ItineraryDay } from "@/types";

export interface RefineSuggestion {
  /** i18n key suffix under `assistant.dyn.*`. */
  key: "busyDay" | "lightDay" | "noFood" | "longGap";
  /** ICU params for that key. */
  params: Record<string, string | number>;
  /**
   * The literal message sent to the assistant when tapped. Kept separate from
   * the label: the label is UI copy, this is the instruction the model gets.
   */
  prompt: string;
}

/** A day is "busy" past this many activities. Tuned to the 3-5/day norm. */
const BUSY_THRESHOLD = 6;
/** ...and "light" at or below this, excluding fully-anchored days. */
const LIGHT_THRESHOLD = 2;
/** A between-activities gap reads as "dead time" from this many minutes. */
const LONG_GAP_MINUTES = 180;

/** "HH:MM" → minutes since midnight, or null on anything unparseable. */
function parseStartMinutes(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

interface DayGap {
  fromName: string;
  toName: string;
  gapMinutes: number;
}

/**
 * The longest between-activities idle stretch in a day, or null when
 * nothing qualifies. Skips pairs where either side has an unparseable
 * start_time or a missing duration — better silent than wrong.
 */
function findLongGap(day: ItineraryDay): DayGap | null {
  const acts = day.activities ?? [];
  let longest: DayGap | null = null;
  for (let i = 0; i < acts.length - 1; i++) {
    const start = parseStartMinutes(acts[i].start_time);
    const nextStart = parseStartMinutes(acts[i + 1].start_time);
    const duration = typeof acts[i].duration_minutes === "number" ? acts[i].duration_minutes : null;
    if (start === null || nextStart === null || duration === null || duration <= 0) continue;
    const gap = nextStart - (start + duration);
    if (gap >= LONG_GAP_MINUTES && (longest === null || gap > longest.gapMinutes)) {
      longest = { fromName: acts[i].name, toName: acts[i + 1].name, gapMinutes: gap };
    }
  }
  return longest;
}

function isFood(a: { type?: string; name?: string }): boolean {
  const t = (a.type ?? "").toLowerCase();
  if (t === "restaurant" || t === "food" || t === "cafe") return true;
  return /breakfast|lunch|dinner|trattoria|restaurant|caf[eé]|tapas|market/i.test(a.name ?? "");
}

/** Days built entirely from anchors are the traveller's own — never suggest changing them. */
function isFullyAnchored(day: ItineraryDay): boolean {
  const acts = day.activities ?? [];
  return acts.length > 0 && acts.every((a) => (a as { locked?: boolean }).locked === true);
}

/**
 * Derive up to `max` suggestions specific to this itinerary.
 *
 * Ordered by how concrete the observation is: an over-full day is the most
 * legible complaint a traveller has about a generated plan, so it leads.
 * Returns [] when nothing specific applies — the caller falls back to the
 * static chips rather than inventing a problem the plan doesn't have.
 */
export function deriveRefineSuggestions(
  days: ItineraryDay[] | null | undefined,
  max = 3
): RefineSuggestion[] {
  const usable = (days ?? []).filter((d) => !isFullyAnchored(d));
  if (usable.length === 0) return [];

  const out: RefineSuggestion[] = [];

  // 1. The busiest day, if it's genuinely over-full.
  const busiest = usable.reduce((a, b) =>
    (b.activities?.length ?? 0) > (a.activities?.length ?? 0) ? b : a
  );
  const busyCount = busiest.activities?.length ?? 0;
  if (busyCount >= BUSY_THRESHOLD) {
    out.push({
      key: "busyDay",
      params: { day: busiest.day_number, count: busyCount },
      prompt: `Day ${busiest.day_number} has ${busyCount} stops and feels packed. Make it more relaxed.`,
    });
  }

  // 2. A day with no food stop — a concrete, obviously-fixable omission.
  const foodless = usable.find(
    (d) => (d.activities?.length ?? 0) > 0 && !(d.activities ?? []).some(isFood)
  );
  if (foodless) {
    out.push({
      key: "noFood",
      params: { day: foodless.day_number },
      prompt: `Day ${foodless.day_number} has nowhere to eat. Add a good local food stop.`,
    });
  }

  // 3. A long dead gap inside a day (P3b — declared in the key union since
  // launch, first implemented 2026-08-16). Concrete and checkable: the
  // traveller can see the 4-hour hole between the museum and dinner.
  for (const d of usable) {
    const gap = findLongGap(d);
    if (gap) {
      const hours = Math.round(gap.gapMinutes / 60);
      out.push({
        key: "longGap",
        params: { day: d.day_number, hours },
        prompt: `Day ${d.day_number} has about ${hours} hours of dead time between ${gap.fromName} and ${gap.toName}. Fill the gap with something nearby.`,
      });
      break; // one gap suggestion is enough — the chips row is small
    }
  }

  // 4. A suspiciously empty day.
  const light = usable.find((d) => (d.activities?.length ?? 0) > 0 && (d.activities?.length ?? 0) <= LIGHT_THRESHOLD);
  if (light) {
    out.push({
      key: "lightDay",
      params: { day: light.day_number, count: light.activities?.length ?? 0 },
      prompt: `Day ${light.day_number} looks empty. Add a couple more things worth doing.`,
    });
  }

  return out.slice(0, max);
}
