import type { TripMeta } from "@/types";

/**
 * Derive the display destination for a trip.
 *
 * Order of preference:
 *   1. meta.destination (or trip_meta.destination)  — canonical, set by wizard
 *   2. title with " Trip" stripped                  — legacy fallback for English
 *   3. raw title                                    — last resort
 *
 * Why this exists
 * ---------------
 * Historically ~14 sites in the codebase computed destination as
 * `trip.title.replace(/ Trip$/, "")`. That breaks for:
 *   - non-English titles ("Viaggio a Roma" → unchanged)
 *   - renamed trips (user customised the title)
 *   - alternate suffixes ("Rome Adventure" → unchanged)
 *
 * The wizard already writes the canonical destination into
 * `trips.trip_meta.destination`, so we prefer that and only fall back
 * to the title-strip when it's missing.
 *
 * Accepts both client-side (`meta`) and server-side (`trip_meta`)
 * naming so the same helper works on shape from `select("*")` and on
 * the prop shape passed to page components.
 */
export function getTripDestination(trip: {
  title?: string | null;
  meta?: TripMeta | null;
  trip_meta?: TripMeta | null | unknown;
}): string {
  // 1. Prefer meta.destination
  const meta = (trip.meta ?? trip.trip_meta ?? null) as TripMeta | null;
  if (meta && typeof meta.destination === "string") {
    const trimmed = meta.destination.trim();
    if (trimmed) return trimmed;
  }

  // 2. Legacy title-strip fallback
  const title = (trip.title ?? "").trim();
  if (!title) return "Unknown";
  const stripped = title.replace(/ Trip$/i, "").trim();
  return stripped || title;
}
