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
 * The single city of a trip destination, ready for an exact (wildcard-free,
 * case-insensitive) ilike inside or(). Empty when there is no one city to look
 * up.
 *
 * - "City, Country": only the part before the first comma. Destinations are
 *   stored with the city in name/city and the country in its own column, so
 *   the full label never matched anyway.
 * - A multi-city route label ("London & Paris", "Osaka, Kyoto & Nagoya", see
 *   joinCities in lib/ai/multi-city-core.ts) has no single centre; the first
 *   city's coordinates would place every other city's activities there.
 *
 * Callers must match EXACTLY on this term, not with %term%: "Nice" inside
 * wildcards matches "Venice", and "York" matches "New York City".
 */
export function destinationCityTerm(destination: string): string {
  if (destination.includes(" & ")) return "";
  return ilikeOrTerm(destination.split(",")[0] ?? "");
}
