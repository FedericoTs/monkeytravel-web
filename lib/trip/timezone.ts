import "server-only";

/**
 * Server-only re-export of the timezone derivation — Live Trip plan, Phase 3.1.
 *
 * The `server-only` guard here is what keeps tz-lookup's ~150KB coordinate
 * table out of any client bundle: app code imports from this module. The pure
 * logic lives in ./derive-timezone.ts so the backfill script (run under tsx,
 * where `server-only` does not resolve) can import it directly.
 */
export { deriveTimezoneFromItinerary } from "./derive-timezone";
