/**
 * What a page beacon (page views, engaged time, consent events) may store
 * about the page it came from: the pathname alone, never a query string or a
 * fragment, which can carry tokens and email addresses; and a language tag.
 */

/** The pathname, cut at `maxLength`, or null for anything that is not a path. */
export function beaconPath(raw: unknown, maxLength = 120): string | null {
  if (typeof raw !== "string" || !raw.startsWith("/")) return null;
  return raw.split(/[?#]/)[0].slice(0, maxLength);
}

/** A language tag like "en" or "en-GB", or null. */
export function beaconLocale(raw: unknown): string | null {
  return typeof raw === "string" && /^[a-z]{2}(-[A-Z]{2})?$/.test(raw) ? raw : null;
}
