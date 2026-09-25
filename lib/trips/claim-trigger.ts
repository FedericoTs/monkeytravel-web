/**
 * When to try claiming a trip this browser shared while signed out.
 *
 * Kept apart from anonymous-claim-client so AuthProvider can decide cheaply,
 * on every page load, without pulling that module into the main bundle.
 */

/** Where the claim token lives (prefs: localStorage on web, Preferences in the app). */
export const CLAIM_TOKEN_KEY = "mt_pending_claim_token";

/**
 * SIGNED_IN covers sign-ins that happen in the browser (password, a code
 * typed in the tab). Google/Apple, magic links and emailed confirmation links
 * finish signing in on the server (/auth/callback), so the page they land on
 * only ever hears INITIAL_SESSION. Until 2026-09-25 the claim listened for
 * SIGNED_IN alone, so those sign-ins never claimed the trip: 6 of the 69
 * trips shared signed-out since 2026-08-21 were claimed.
 */
export function shouldTryClaim(event: string, hasUser: boolean): boolean {
  if (!hasUser) return false;
  return event === "SIGNED_IN" || event === "INITIAL_SESSION";
}
