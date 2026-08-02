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

  // 3. A suspiciously empty day.
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
