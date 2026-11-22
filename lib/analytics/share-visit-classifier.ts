/**
 * One verdict for "did a recipient just open this shared trip?", applied to
 * both sinks the shared page writes — funnel_events.share_link_visited and the
 * PostHog crew_link_visited twin — so the two counters stay comparable.
 *
 * Why it exists: counted naively, most share_link_visited rows are not
 * recipients — cookieless non-document renders, scraper fleets on the
 * demo trips, and owners opening their own link.
 *
 * Pure: takes header values, never reads next/headers, so it is unit-tested
 * (share-visit-classifier.vitest.ts) the same way as page-view-classifier.ts.
 */
export type SharedVisitVerdict =
  | "counted"
  | "skip:crawler"
  | "skip:prefetch"
  | "skip:fetch"
  | "skip:demo"
  | "skip:owner";

// Obvious crawlers / link-unfurlers only. Deliberately does NOT match
// "whatsapp"/"telegram" anywhere in the user agent: a human tapping a shared
// link opens it in the app's in-app browser with a normal Chrome/Safari UA,
// which may name the app, and those are the exact people the crew loop
// targets. A user agent that STARTS with "WhatsApp/" is the app fetching the
// link's preview, never a person's browser: counted, it made a link pasted
// into a chat look opened.
export const CRAWLER_UA_RE =
  /(bot\b|crawl|spider|slurp|facebookexternalhit|bingpreview|headless|python-requests|curl\/|wget|lighthouse|monitoring|uptime|^whatsapp\/)/i;

export interface SharedVisitInput {
  userAgent: string | null;
  /** sec-fetch-dest: "document" for a navigation, "empty" for a router fetch, null from non-browsers. */
  secFetchDest: string | null;
  /** purpose / sec-purpose carry "prefetch" while the browser is speculating. */
  purpose: string | null;
  secPurpose: string | null;
  /** The viewer is the trip's owner, opening their own link. */
  isOwner: boolean;
  /** Somebody shared the trip (sharedBySomeone). The demo trips are shared by nobody: fleets crawl them. */
  tripWasShared: boolean;
}

/**
 * Whether somebody shared a trip: it has an owner, or it still carries the claim a signed-out planner's browser
 * holds for the trip they sent. The demo trips have neither.
 */
export function sharedBySomeone(trip: { user_id?: unknown; claim_token?: unknown }): boolean {
  return Boolean(trip.user_id) || Boolean(trip.claim_token);
}

export function classifySharedVisit(input: SharedVisitInput): SharedVisitVerdict {
  const ua = input.userAgent ?? "";
  if (ua === "" || CRAWLER_UA_RE.test(ua)) return "skip:crawler";
  if (input.purpose === "prefetch" || (input.secPurpose ?? "").includes("prefetch")) {
    return "skip:prefetch";
  }
  // A React Server Components fetch (router refresh, prefetch, in-app
  // navigation) renders this page on the server exactly like a navigation
  // does. Only a document request is a visit; a client that sends no fetch
  // metadata at all (older webviews) still counts.
  if (input.secFetchDest !== null && input.secFetchDest !== "document") return "skip:fetch";
  if (!input.tripWasShared) return "skip:demo";
  if (input.isOwner) return "skip:owner";
  return "counted";
}
