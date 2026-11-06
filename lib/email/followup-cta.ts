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
 * - the later slots exist to start a NEW trip → the wizard.
 */
export function postTripCtaUrl(slot: TripFollowupSlot, opts: FollowupCtaOpts): string {
  if (slot === "followup_return_3d") return wentUrl("yes", opts) ?? opts.tripUrl;
  return `${opts.appUrl}/trips/new?slot=${slot}`;
}

/** followup_return_3d's other button, which answers no. Null leaves it out. */
export function didNotGoUrl(opts: FollowupCtaOpts): string | null {
  return wentUrl("no", opts);
}
