/**
 * When to hand a browser's guest history to the account that signs in on it.
 *
 * The share page notes that this browser was there signed out, where it may
 * have said "I'm going" or paid as a guest. The next sign-in, at the same
 * moments as the trip claim (lib/trips/claim-trigger.ts), posts to
 * /api/participants/link and clears the note once that worked.
 */

/** Where the note lives (prefs: localStorage on web, Preferences in the app). */
export const GUEST_LINK_KEY = "mt_pending_guest_link";
