/**
 * Find a coordinate for a trip, from the itinerary the generator already wrote.
 *
 * The forecast lookup needs a lat/lng. trips has no coordinate column, but
 * activities carry one: `itinerary[].activities[].coordinates = {lat, lng}`.
 * Measured over the trips with queued reminders, 100% have at least one.
 *
 * WHY THE MEDIAN OF DAY ONE, AND NOT THE FIRST ACTIVITY
 * ----------------------------------------------------
 * These coordinates are model-generated, and the model sometimes invents one.
 * Measured across the 146 trips holding a queued weather email:
 *
 *   "Taipei Trip" day 1 — Elephant Mountain at 27.767,121.570. The longitude
 *   is right; the latitude is not. It sits 300km away in mainland China while
 *   all 24 other coordinates in that trip cluster at ~25.03. Taking the first
 *   activity picked exactly the bad one and would have fetched a real
 *   forecast for the wrong country — which is worse than the invented note it
 *   replaced, because it looks authoritative.
 *
 * The median is unmoved by a single outlier, and day one's activities are all
 * in one place, so it is a well-behaved statistic here. Median per axis rather
 * than a geometric median: cheaper, and enough for points inside one city.
 *
 * WHAT THIS STILL CANNOT CATCH
 * ----------------------------
 * One trip in that same set — "edinburgh, highland, ardvasar & edinburgh" —
 * has EVERY coordinate at ~48.0,10.0, in Bavaria. The Royal Mile, Dunkeld and
 * Glencoe are all placed in southern Germany. Nothing derived from the
 * coordinates can detect that, because they agree with each other. It needs
 * the trip's own name to catch, and geocoding names is unreliable enough
 * (Bali resolves to India, Napoli to Gambia, Lisboa to Mozambique) that
 * putting it in the send path would suppress correct forecasts more often
 * than it caught wrong ones. Documented rather than papered over.
 *
 * WHY DAY ONE
 * -----------
 * A multi-city trip spans places with genuinely different weather. Averaging
 * "Palermo, Agrigento, Syracuse & Taormina" gives a point in the sea between
 * them, and averaging "Tokyo & Sydney" gives a forecast for nowhere on Earth.
 * Day one is where the traveller actually starts, which is the honest answer
 * to "what should I pack for the day I arrive".
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

/** Every usable coordinate on one day, in order. */
function dayCoordinates(day: unknown): TripCoordinate[] {
  const out: TripCoordinate[] = [];
  if (!day || typeof day !== "object") return out;
  const activities = (day as Record<string, unknown>).activities;
  if (!Array.isArray(activities)) return out;

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

    out.push({ latitude, longitude });
  }
  return out;
}

/** Lower median — no averaging, so the result is always a real observation. */
function median(values: number[]): number {
  return [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) / 2)];
}

/**
 * A representative coordinate for the start of the trip, or null.
 *
 * Scans days in order and uses the first day that has any usable coordinate —
 * a trip whose day one carries none should still get a forecast.
 */
export function tripStartCoordinate(itinerary: unknown): TripCoordinate | null {
  if (!Array.isArray(itinerary)) return null;

  for (const day of itinerary) {
    const points = dayCoordinates(day);
    if (points.length === 0) continue;
    if (points.length === 1) return points[0];

    const lons = points.map((p) => p.longitude);
    // Component-wise medians are meaningless across the antimeridian: -179
    // and 179 are neighbours, and their median is 0. Rare enough (Fiji, the
    // far east of New Zealand) that falling back to the first point is a
    // better trade than the arithmetic to handle it properly.
    if (Math.max(...lons) - Math.min(...lons) > 180) return points[0];

    return {
      latitude: median(points.map((p) => p.latitude)),
      longitude: median(lons),
    };
  }

  return null;
}
