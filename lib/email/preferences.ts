/**
 * The email switches a user can flip, and the rule for marketing consent.
 *
 * The notification settings page (/profile/notifications, the "Manage
 * preferences" link in every email footer) renders exactly EMAIL_PREFERENCES,
 * and a test holds them to lib/email/send.ts: every category the pipeline
 * gates has a switch, and every switch gates something. Until 2026-09-25 the
 * page offered four switches no email ever read ("Weekly digest", "Proposed
 * activities", "Comments", "Invite accepted") and none for trip reminders or
 * marketing, which most emails are.
 */

export const EMAIL_PREFERENCES = [
  // Stops every email the pipeline gates. Invitations someone sends to an
  // address, and sign-in emails, are not gated and still arrive.
  { key: "emailNotifications", kind: "master" },
  // trip_reminder (pre-trip cascade) and trip_day_digest (in-trip days).
  { key: "tripReminders", kind: "transactional" },
  // vote_cast.
  { key: "collabVotes", kind: "transactional" },
  // trip_followup, feedback_outreach, one-off notices, Resend broadcasts.
  { key: "marketingNotifications", kind: "marketing" },
] as const;

export type EmailPreferenceKey = (typeof EMAIL_PREFERENCES)[number]["key"];

/**
 * Whether marketing email (Resend broadcasts, post-trip follow-ups) must stop.
 *
 * Either switch stops it: the master switch promises no emails, so it has to
 * reach the broadcast audience too. The audience sync used to read only
 * marketingNotifications, so someone who switched everything off kept getting
 * broadcasts. Only an explicit false opts out; a missing key is the signup
 * default, which is on.
 */
export function isMarketingOptedOut(settings: unknown): boolean {
  const ns = (settings ?? {}) as Record<string, unknown>;
  return ns.marketingNotifications === false || ns.emailNotifications === false;
}
