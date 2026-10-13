/**
 * Live Trip Phase 2 — "I'm going" rollback switch.
 *
 * ON by default. Set NEXT_PUBLIC_LIVE_TRIP_PARTICIPANTS=off to return the
 * recipient page to the browse layout (vote banner, like/save/fork bar,
 * fixed Save bar) and to close the join route. A public env var because the
 * header renders client-side; the routes read the same value so the UI and
 * the API can never disagree.
 *
 * The plan's kill criterion (tap rate < 5% after 4 weeks with >= 300 human
 * recipient sessions) is decided by a person from the weekly snapshot; this
 * switch is how that decision is executed without a deploy of code.
 */
export function isLiveTripParticipantsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_LIVE_TRIP_PARTICIPANTS !== "off";
}

/**
 * Also send the in-trip digest to the trip's emailed participants. OFF by
 * default, and separate from the owner cascade so the fan-out is a deliberate
 * rollout; TRIP_NOTIFICATIONS_SEND_CAP counts owner rows only. Server-only:
 * the env var is not public, so in the browser this reads false.
 */
export function isParticipantDigestEnabled(): boolean {
  return process.env.PARTICIPANT_DIGEST_ENABLED === "true";
}
