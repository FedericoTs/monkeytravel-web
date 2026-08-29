/**
 * Find a coordinate for a trip, from the itinerary the generator already wrote.
 *
 * The forecast lookup needs a lat/lng. trips has no coordinate column, but
 * activities carry one: `itinerary[].activities[].coordinates = {lat, lng}`.
 * Measured over the 144 trips with queued reminders, 143 (99.3%) have at least
 * one — so this is a viable source rather than a best-effort one.
 *
 * WHY THE FIRST ONE, AND NOT AN AVERAGE
 * -------------------------------------
 * A multi-city trip spans places with genuinely different weather. Averaging
 * "Palermo, Agrigento, Syracuse & Taormina" gives a point in the sea between
 * them, and averaging "Tokyo & Sydney" gives a forecast for nowhere on Earth.
 *
 * The first activity of day one is where the traveller actually starts, which
 * is the honest answer to "what should I pack for the day I arrive". It is
 * also the day the confirm_1d and morning_of slots are literally about.
 *
 * Deliberately NOT averaged, NOT the centroid, NOT the "main" city — each of
 * those would invent a location, and inventing is the failure this whole
 * change exists to undo.
 *
 * Input is jsonb from a model-generated column, so everything is `unknown`
 * and anything unparseable yields null.
 */

export interface TripCoordinate {
  latitude: number;
  longitude: number;
}

/** Accepts a number or a numeric string — jsonb gives back both. */
function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * The first usable coordinate in the itinerary, scanning days in order and
 * activities within each day in order. Returns null when there is none.
 */
export function firstCoordinate(itinerary: unknown): TripCoordinate | null {
  if (!Array.isArray(itinerary)) return null;

  for (const day of itinerary) {
    if (!day || typeof day !== "object") continue;
    const activities = (day as Record<string, unknown>).activities;
    if (!Array.isArray(activities)) continue;

    for (const activity of activities) {
      if (!activity || typeof activity !== "object") continue;
      const c = (activity as Record<string, unknown>).coordinates;
      if (!c || typeof c !== "object") continue;

      const rec = c as Record<string, unknown>;
      // The generator writes {lat, lng}; accept the long spellings too rather
      // than silently skipping a trip over a key name.
      const latitude = num(rec.lat) ?? num(rec.latitude);
      const longitude = num(rec.lng) ?? num(rec.lon) ?? num(rec.longitude);
      if (latitude === null || longitude === null) continue;

      // Out-of-range values are corrupt, not merely odd. (0,0) is Null Island
      // — a real coordinate in the Atlantic that in practice always means a
      // missing value, and a forecast for open ocean would be worse than none.
      if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) continue;
      if (latitude === 0 && longitude === 0) continue;

      return { latitude, longitude };
    }
  }

  return null;
}
