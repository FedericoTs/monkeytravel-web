/**
 * One verdict for "did a recipient just open this shared trip?", applied to
 * both sinks the shared page writes — funnel_events.share_link_visited and the
 * PostHog crew_link_visited twin — so the two counters stay comparable.
 *
 * Why it exists (read of 2026-09-18, 30 days): 1,494 share_link_visited rows
 * were 946 cookieless, non-document renders of one trip in one hour, ~70
 * scraper-fleet hits on the ownerless demo trips, and 27 sessions of owners
 * opening their own link. About 65 rows were recipients.
 *
 * Pure: takes header values, never reads next/headers, so it is unit-tested
 * (share-visit-classifier.vitest.ts) the same way as page-view-classifier.ts.
 */
export type SharedVisitVerdict =
  | "counted"
  | "skip:crawler"
  | "skip:prefetch"
  | "skip:fetch"
  | "skip:no-owner"
  | "skip:owner";

// Obvious crawlers / link-unfurlers only. Deliberately does NOT match
// "whatsapp"/"telegram" — a human tapping a shared link opens it in the app's
// in-app browser with a normal Chrome/Safari UA; the "WhatsApp"/"TelegramBot"
// UA is the preview crawler. We accept a little unfurl inflation rather than
// risk dropping the exact humans (chat-app openers) the crew loop targets.
export const CRAWLER_UA_RE =
  /(bot\b|crawl|spider|slurp|facebookexternalhit|bingpreview|headless|python-requests|curl\/|wget|lighthouse|monitoring|uptime)/i;

export interface SharedVisitInput {
  userAgent: string | null;
  /** sec-fetch-dest: "document" for a navigation, "empty" for a router fetch, null from non-browsers. */
  secFetchDest: string | null;
  /** purpose / sec-purpose carry "prefetch" while the browser is speculating. */
  purpose: string | null;
  secPurpose: string | null;
  /** The viewer is the trip's owner, opening their own link. */
  isOwner: boolean;
  /** The demo trips have no owner: nobody shares them, fleets crawl them. */
  tripHasOwner: boolean;
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
  if (!input.tripHasOwner) return "skip:no-owner";
  if (input.isOwner) return "skip:owner";
  return "counted";
}
