/**
 * Hostelworld affiliate link generator.
 *
 * Strategic context (shipped 2026-05-28 as part of the Hostelworld
 * partnership wedge — see Backpacker Mode in lib/gemini.ts):
 *
 * Hostelworld is NOT on the Travelpayouts network we use for other
 * partners (Booking, Agoda, Expedia, etc.). They run their affiliate
 * program through Awin (merchant ID 3018).
 *
 * Affiliate behaviour:
 *   - HOSTELWORLD_AWIN_AFFILIATE_ID env set → URLs wrapped in Awin
 *     redirect so clicks are attributed to us and commission is paid.
 *   - HOSTELWORLD_AWIN_AFFILIATE_ID env absent → returns clean
 *     Hostelworld search URL anyway. Users still get value; we just
 *     don't get credit. This lets us SHIP the CTA today (before any
 *     formal affiliate sign-up) and start measuring CTR from our own
 *     analytics. The number we then bring to Hostelworld is:
 *       "we already drove X clicks last month with zero attribution
 *        — let's make this official."
 *
 * Once HOSTELWORLD_AWIN_AFFILIATE_ID lands in Vercel env, the same
 * code instantly starts attributing. No deploy needed for that flip.
 */

// Hostelworld's known Awin merchant ID. Public info, fine to inline.
const HOSTELWORLD_AWIN_MERCHANT_ID = "3018";

// Affiliate ID from env. Both names accepted so it can live alongside
// any future generic AWIN_AFFILIATE_ID we add for other Awin merchants.
const AWIN_AFFILIATE_ID =
  process.env.HOSTELWORLD_AWIN_AFFILIATE_ID ||
  process.env.AWIN_AFFILIATE_ID ||
  "";

export interface HostelSearchParams {
  /** Destination string from the trip — e.g. "Barcelona" or "Barcelona, Spain". */
  destination: string;
  /** Check-in date (YYYY-MM-DD). */
  startDate: string;
  /** Check-out date (YYYY-MM-DD). */
  endDate: string;
  /** Number of guests. Defaults to 1 (backpacker default — solo traveller). */
  guests?: number;
}

/**
 * Generate a Hostelworld search URL for a trip. See file header for
 * the attribution behaviour.
 */
export function getHostelworldSearchUrl(params: HostelSearchParams): string {
  // Hostelworld's search accepts a single "search-keyword" — passing
  // the city alone (split off any country suffix) gives the cleanest
  // results page. "Barcelona, Spain" → "Barcelona".
  const city = params.destination.split(",")[0].trim();
  const guests = params.guests ?? 1;

  const qs = new URLSearchParams({
    "search-keyword": city,
    "date-start": params.startDate,
    "date-end": params.endDate,
    "number-of-guests": String(guests),
  });
  const directUrl = `https://www.hostelworld.com/pwa/wds/s?${qs.toString()}`;

  if (AWIN_AFFILIATE_ID) {
    // Awin redirect URL pattern. `ued` is the URL-encoded landing page.
    return `https://www.awin1.com/cread.php?awinmid=${HOSTELWORLD_AWIN_MERCHANT_ID}&awinaffid=${encodeURIComponent(AWIN_AFFILIATE_ID)}&ued=${encodeURIComponent(directUrl)}`;
  }

  return directUrl;
}

/**
 * Whether the Hostelworld link is tracked back to us for commission.
 * Useful for analytics + the affiliate disclosure tag (show "Affiliate
 * link" badge only when it actually pays).
 */
export function isHostelworldAffiliateActive(): boolean {
  return AWIN_AFFILIATE_ID !== "";
}
