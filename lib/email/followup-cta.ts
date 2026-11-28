/**
 * Where a post-trip followup email's buttons point — ONE definition.
 *
 * This rule lived inline in three places (the cron, scripts/audit-queued-emails,
 * scripts/send-test-emails). The subject rule taught the lesson once already —
 * it drifted across its copies within the hour — so this is shared, and the
 * audit that vets what the cron will send computes the exact same URL the cron
 * does.
 *
 * Relative import of buildWentUrl (not `@/`) so the tsx scripts, which load
 * lib modules by relative path, resolve it the same way the Next build does.
 */
import { buildWentUrl } from "../feedback/token";
import type { WentAnswer } from "../feedback/went";
import type { TripFollowupSlot } from "./templates/TripFollowup";

export interface FollowupCtaOpts {
  /** The trip page URL, the fallback when an answer link can't be signed. */
  tripUrl: string;
  /** Absolute app origin, e.g. https://monkeytravel.app. */
  appUrl: string;
  /** Recipient user id — mints the answer links' token. */
  userId: string;
  /** Recipient locale — localizes the answer links' path. */
  locale: string;
  /** The finished trip — the one the answer links ask about. */
  tripId: string;
  /** When the email is built: the next trip's month counts from it. Now when left out. */
  now?: Date;
}

/** The month guides' addresses, the same in every language: content/blog/(es|it|pt/)where-to-go-in-<month>.md. */
const GUIDE_MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
] as const;

/** How far ahead a trip is usually planned, in days: the next trip's month is this far from now. */
export const NEXT_TRIP_LEAD_DAYS = 45;

/** The month (0-11, UTC) a next trip planned at `now` would most likely fall in. */
export function nextTripMonth(now: Date): number {
  return new Date(now.getTime() + NEXT_TRIP_LEAD_DAYS * 86_400_000).getUTCMonth();
}

/** That month's guide in the recipient's language, every place in it a tap from a plan, the click counted by slot. */
function monthGuideUrl(slot: TripFollowupSlot, opts: FollowupCtaOpts): string {
  const month = GUIDE_MONTHS[nextTripMonth(opts.now ?? new Date())];
  const prefix = ["es", "it", "pt"].includes(opts.locale) ? `/${opts.locale}` : "";
  return `${opts.appUrl}${prefix}/blog/where-to-go-in-${month}?slot=${slot}`;
}

/** Null when the link secret is unavailable. */
function wentUrl(answer: WentAnswer, opts: FollowupCtaOpts): string | null {
  try {
    return buildWentUrl(opts.userId, opts.tripId, answer, opts.locale, opts.appUrl);
  } catch {
    return null;
  }
}

/**
 * - followup_return_3d asks "did you go?": its CTA answers yes. A followup must
 *   never fail to send over a missing link secret, so without one it opens the
 *   trip.
 * - the later slots exist to start a NEW trip → the guide to the month it would likely fall in, where each place
 *   opens the planner for that month (a blank planner leaves "where?" unanswered).
 */
export function postTripCtaUrl(slot: TripFollowupSlot, opts: FollowupCtaOpts): string {
  if (slot === "followup_return_3d") return wentUrl("yes", opts) ?? opts.tripUrl;
  return monthGuideUrl(slot, opts);
}

/** followup_return_3d's other button, which answers no. Null leaves it out. */
export function didNotGoUrl(opts: FollowupCtaOpts): string | null {
  return wentUrl("no", opts);
}
