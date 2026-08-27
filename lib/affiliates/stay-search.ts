/**
 * Accommodation search links.
 *
 * WHY THIS REPLACED THE HOSTELWORLD BUILDER
 * getHostelworldSearchUrl() emitted https://www.hostelworld.com/pwa/wds/s?...
 * That path 301s to /pwa/s, which returns 404. Every "Find stays" link on the
 * site — homepage leaderboard, seasonal blog posts, /backpacker, trip pages —
 * was landing on a dead page.
 *
 * Hostelworld's working alternative is a path-based city page
 * (/hostels/<city>), and it was rejected for a specific reason: unknown terms
 * do not 404, they silently resolve to an unrelated city. Measured 2026-08-27:
 *
 *   /hostels/bali                 -> /hostels/asia/bahrain/            (wrong country)
 *   /hostels/asia/indonesia/bali  -> /hostels/europe/france/paris/     (wrong continent)
 *   /hostels/Rio%20de%20Janeiro   -> 404
 *
 * Sending someone looking for Bali to Bahrain is worse than sending them
 * nowhere, and the leaderboard can name any city a traveller has planned, so
 * an allowlist of pre-verified slugs would not cover it either.
 *
 * Booking.com takes the destination as a QUERY parameter rather than a path
 * segment, so an unrecognised value produces a search page, never a confident
 * redirect to the wrong country. Verified in a real browser: Bali, Rio de
 * Janeiro and Tokyo each resolve to the correct destination.
 *
 * NOT WRAPPED IN TRAVELPAYOUTS TRACKING, deliberately. The wrapper at
 * c84.travelpayouts.com/click returns HTTP 400 — the account's partner
 * programs are inactive, so wrapping would trade a working link for a broken
 * one in exchange for zero revenue. buildStayAffiliateUrl() below is where
 * tracking goes if that is ever switched on; nothing else needs to change.
 */

export interface StaySearchParams {
  /** Destination as a human string, e.g. "Tokyo" or "Rio de Janeiro". */
  destination: string;
  /** Check-in, YYYY-MM-DD. */
  startDate: string;
  /** Check-out, YYYY-MM-DD. */
  endDate: string;
  /** Defaults to 1 — the solo-traveller default the backpacker surface assumes. */
  guests?: number;
  /**
   * Restrict results to hostels. Used by /backpacker and the backpacker trip
   * style, where "find a hotel" would be the wrong product.
   */
  hostelsOnly?: boolean;
}

/** Booking.com's property-type id for hostels, used in the `nflt` filter. */
const BOOKING_HOSTEL_PROPERTY_TYPE = "ht_id=203";

export function getStaySearchUrl(params: StaySearchParams): string {
  const { destination, startDate, endDate, guests = 1, hostelsOnly = false } = params;

  // "Barcelona, Spain" searches fine, but the bare city is what actually
  // matches Booking's destination index most reliably.
  const city = destination.split(",")[0].trim();

  const url = new URL("https://www.booking.com/searchresults.html");
  url.searchParams.set("ss", city);
  url.searchParams.set("checkin", startDate);
  url.searchParams.set("checkout", endDate);
  url.searchParams.set("group_adults", String(guests));
  url.searchParams.set("no_rooms", "1");
  if (hostelsOnly) url.searchParams.set("nflt", BOOKING_HOSTEL_PROPERTY_TYPE);

  return buildStayAffiliateUrl(url.toString());
}

/**
 * Single seam for affiliate tracking.
 *
 * Returns the target untouched today. When a partner program is actually
 * live, wrap here — every stay link in the product flows through this one
 * function, so nothing else has to change and no surface can be forgotten.
 */
function buildStayAffiliateUrl(targetUrl: string): string {
  return targetUrl;
}

/**
 * Whether stay links currently earn anything. False today: Travelpayouts
 * returns 400 for this account and no AWIN id is configured.
 *
 * Callers use this for the `rel` attribute and the affiliate disclosure —
 * claiming "sponsored" on a link that pays nothing states something untrue
 * about the relationship, to Google and to the reader alike.
 */
export function isStayAffiliateActive(): boolean {
  return false;
}
