import tzlookup from "tz-lookup";
import type { ItineraryDay } from "@/types";
import { isValidTimeZone } from "./live";

/**
 * Derive a trip's IANA timezone from its itinerary — Live Trip plan, Phase 3.1.
 *
 * The pure logic, kept free of the `server-only` guard so the backfill script
 * (scripts/backfill-trip-timezone.mts, run under tsx) can import it. The app
 * imports the guarded re-export in ./timezone.ts instead, which is what keeps
 * tz-lookup's ~150KB coordinate table out of the client bundle.
 *
 * The first activity that carries valid coordinates decides the zone. For a
 * single-city trip every activity shares it; for a multi-city trip the first
 * city is where "today" begins, the right anchor for a day counter.
 */
export function deriveTimezoneFromItinerary(itinerary: ItineraryDay[] | null | undefined): string | null {
  if (!Array.isArray(itinerary)) return null;
  for (const day of itinerary) {
    const activities = Array.isArray(day?.activities) ? day.activities : [];
    for (const activity of activities) {
      const c = activity?.coordinates;
      if (c && typeof c.lat === "number" && typeof c.lng === "number" && Number.isFinite(c.lat) && Number.isFinite(c.lng)) {
        if (c.lat === 0 && c.lng === 0) continue; // null-island / missing
        if (Math.abs(c.lat) > 90 || Math.abs(c.lng) > 180) continue; // junk
        try {
          const zone = tzlookup(c.lat, c.lng);
          if (isValidTimeZone(zone)) return zone;
        } catch {
          // tz-lookup throws on out-of-range; keep scanning.
        }
      }
    }
  }
  return null;
}
