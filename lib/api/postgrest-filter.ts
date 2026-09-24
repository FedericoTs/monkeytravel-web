/**
 * Put user-supplied text inside a PostgREST `or=(...)` ilike filter safely.
 *
 * Inside `or()`, a comma separates conditions and parentheses group them, so a
 * value like "Chennai, India" splits the filter into a second, malformed
 * condition and PostgREST answers 400. `%` and `_` are ILIKE wildcards and
 * must be escaped to match literally.
 */

/** Escape ILIKE wildcards and drop PostgREST delimiters. */
export function ilikeOrTerm(input: string): string {
  return input
    .replace(/[%_\\]/g, "\\$&")
    .replace(/[,()"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The city part of a "City, Country" destination, ready for an or() ilike.
 *
 * Destinations are stored with the city in name/city and the country in its
 * own column, so "%Chennai, India%" would never match anyway. Only the part
 * before the first comma carries matching value (the same choice
 * app/api/explore/trips/route.ts made for /destinations/[slug]).
 */
export function destinationCityTerm(destination: string): string {
  return ilikeOrTerm(destination.split(",")[0] ?? "");
}
