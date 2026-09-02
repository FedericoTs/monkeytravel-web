/**
 * What should the wizard do with the itinerary draft it found on mount?
 *
 * The generated itinerary survives an auth round-trip only as a localStorage
 * draft. Until 2026-09-02 the wizard auto-restored it ONLY when
 * `pendingTripGeneration` was set — a flag written in exactly four places, all
 * inside AuthPromptModal. So the Save-modal path worked and every other way
 * back into an account (header Sign-in, /auth/login, a magic link, a return
 * the next day) landed on a blank wizard with the itinerary sitting unread
 * beside it. Measured over 30 days: 96 signed-out result sessions end with a
 * signed-in user on the same session cookie, and 13 of those finished with no
 * trip at all.
 *
 * The decision lives here, out of the 4,000-line component, because its
 * sharpest edge is a state most tests never simulate: `isAuthenticated` is
 * TRI-STATE and is `null` on every first render while auth resolves. Treating
 * null as "not signed in" shows the recovery banner to someone who is signed
 * in and latches it — the effect that would have auto-restored never gets a
 * second turn. "wait" exists to make that impossible to express.
 */

export type DraftRestoreDecision =
  /** Auth has not resolved. Do nothing at all — not even show the banner. */
  | "wait"
  /** Put the itinerary straight back on screen, no clicks. */
  | "auto-restore"
  /** Signed out: offer recovery and let them choose. */
  | "offer-banner"
  /** Nothing to recover, or it is already handled. */
  | "idle";

export interface DraftRestoreInput {
  /** A draft exists in storage. */
  hasDraft: boolean;
  /** That draft carries a generated itinerary (not just form fields). */
  hasItineraryInDraft: boolean;
  /** This mount already restored it. */
  alreadyRestored: boolean;
  /** An itinerary is already on screen — never overwrite it. */
  itineraryOnScreen: boolean;
  /** null while auth is still resolving. */
  isAuthenticated: boolean | null;
  /** The trip has already been persisted; the draft is spent. */
  savedTripId: string | null;
  /** AuthPromptModal's flag: the user came back specifically to finish a save. */
  pendingTripGeneration: boolean;
}

export function decideDraftRestore(input: DraftRestoreInput): DraftRestoreDecision {
  const {
    hasDraft,
    hasItineraryInDraft,
    alreadyRestored,
    itineraryOnScreen,
    isAuthenticated,
    savedTripId,
    pendingTripGeneration,
  } = input;

  if (!hasDraft || alreadyRestored || itineraryOnScreen) return "idle";
  // Before auth is known, doing nothing is the only safe move: showing the
  // banner here would latch it for a user who turns out to be signed in.
  if (isAuthenticated === null) return "wait";

  // The Save-modal path restores even a form-only draft, because the user
  // explicitly asked to save and is mid-flow.
  if (pendingTripGeneration) return "auto-restore";

  // Everyone else needs something worth putting back on screen.
  if (!hasItineraryInDraft) return isAuthenticated ? "idle" : "offer-banner";

  // Signed in with an unsaved itinerary in hand: put it back, no clicks. A
  // saved trip means the draft is spent and must never resurrect.
  if (isAuthenticated && !savedTripId) return "auto-restore";

  return isAuthenticated ? "idle" : "offer-banner";
}
