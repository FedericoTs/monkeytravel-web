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
