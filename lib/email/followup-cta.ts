/**
 * Where a post-trip followup email's CTA points — ONE definition.
 *
 * This rule lived inline in three places (the cron, scripts/audit-queued-emails,
 * scripts/send-test-emails) and Phase 4.3 changed it (followup_return_3d now
 * opens the feedback survey, not the trip). The subject rule taught the lesson
 * once already — it drifted across its copies within the hour — so this is
 * shared, and the audit that vets what the cron will send computes the exact
 * same URL the cron does.
 *
 * Relative import of buildFeedbackUrl (not `@/`) so the tsx scripts, which load
 * lib modules by relative path, resolve it the same way the Next build does.
 */
import { buildFeedbackUrl } from "../feedback/token";
import type { TripFollowupSlot } from "./templates/TripFollowup";

export interface FollowupCtaOpts {
  /** The trip page URL (the fallback + the pre-4.3 target). */
  tripUrl: string;
  /** Absolute app origin, e.g. https://monkeytravel.app. */
  appUrl: string;
  /** Recipient user id — mints the feedback token. */
  userId: string;
  /** Recipient locale — localizes the /feedback path. */
  locale: string;
}

/**
 * - followup_return_3d ("How was X?") → the feedback survey (Phase 4.3): a
 *   tokenized /feedback/<token> link. If the link secret is unavailable
 *   buildFeedbackUrl throws, and we fall back to the trip — a followup must
 *   never fail to send over a missing survey link.
 * - the later slots exist to start a NEW trip → the wizard.
 */
export function postTripCtaUrl(slot: TripFollowupSlot, opts: FollowupCtaOpts): string {
  if (slot === "followup_return_3d") {
    try {
      return buildFeedbackUrl(opts.userId, opts.locale, opts.appUrl);
    } catch {
      return opts.tripUrl;
    }
  }
  return `${opts.appUrl}/trips/new?slot=${slot}`;
}
