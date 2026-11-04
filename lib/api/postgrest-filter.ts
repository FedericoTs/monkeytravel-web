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
 * What a visitor typed into a search box, as an ilike term: dots and
 * brackets dropped, so "Washington D.C." still finds "Washington DC", then
 * ilikeOrTerm.
 */
export function ilikeSearchTerm(input: string): string {
  return ilikeOrTerm(input.replace(/[.[\]{}]/g, ""));
}
