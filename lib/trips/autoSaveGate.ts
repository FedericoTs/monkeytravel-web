/**
 * Who persists a generated trip? Exactly one owner, for every flag state.
 *
 * WHY THIS EXISTS
 * ---------------
 * /trips/new has two persistence paths and a three-state flag:
 *
 *   auto-save-v1 = true       the useAutoSaveTrip hook persists every generation
 *   auto-save-v1 = false      the hook is inert; the post-auth redemption effect
 *                             replays the Save the user already clicked
 *   auto-save-v1 = undefined  PostHog has not resolved the flag
 *
 * The third state is not a transient. Analytics consent declined, an ad
 * blocker, or a failed PostHog request leave it undefined FOREVER - there is no
 * later evaluation to wait for.
 *
 * The original code asked `=== true` for the hook and `=== false` for the
 * redemption effect. undefined satisfied NEITHER, so for that cohort a signed-in
 * user generated an itinerary and nothing persisted it. The trip was silently
 * dropped unless they found the manual Save button.
 *
 * Measured 2026-09-01, before the fix: 30 users burned 44 successful AI
 * generations and finished with zero trips. Among users who reached generation
 * at all, those who ended with nothing were half as likely to have analytics
 * consent (36.7% vs 69.9%) - the signature of an unresolved flag, not of a
 * user who changed their mind.
 *
 * auto-save-v1 has been at rollout_percentage 100 since 2026-07-02, so ON is
 * the intended behaviour for everyone. Unresolved therefore fails OPEN. That is
 * also the safe direction: persisting a trip the user asked for is never the
 * harmful outcome; losing it is.
 *
 * These two predicates are deliberately kept together, and the test asserts
 * they are never both true and never both false for the same input. That
 * mutual exclusivity is the real invariant - split across two files it drifted
 * once already, and the failure was invisible because both sides "looked" safe.
 */

/** Flag value as `useFlag` reports it: resolved true/false, or unresolved. */
export type FlagState = boolean | undefined;

/**
 * Should the useAutoSaveTrip hook persist generations?
 *
 * True unless the flag RESOLVED to false (the kill-switch). Unresolved fails
 * open - see the module docblock.
 */
export function shouldAutoSave(flag: FlagState): boolean {
  return flag !== false;
}

/**
 * Should the post-auth redemption effect replay the user's Save click?
 *
 * Only when the flag RESOLVED to false, i.e. exactly when the hook above is
 * inert. This is the complement of shouldAutoSave, which is what guarantees no
 * path is ever left without an owner and no trip is ever saved twice.
 */
export function shouldRedeemSaveIntent(flag: FlagState): boolean {
  return flag === false;
}
