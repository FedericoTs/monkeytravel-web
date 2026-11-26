import { safeGet, safeRemove, safeSet } from "@/lib/safe-storage";

/**
 * The card on the plan of a visit's second place (components/wizard/KeepBothCard.tsx): a signed-out planner with two
 * or more places planned in the tab is asked to keep them all with a free account, and the sign-in saves every one
 * (lib/wizard/visit-trips.ts). Visitors who make two plans are the ones who sign in, and they do it after the second.
 * "Not now" hides it for the tab. Its sign-ins are told apart by a mark set when its Sign in is pressed, read once on
 * the signed-in return, and dropped when the box closes without one.
 */

const DISMISSED = "mt_keep_both_dismissed";
const SHOWN = "mt_keep_both_shown";
const FROM_CARD = "mt_keep_both_card";

/** Signed out, a plan on screen and not saved, two or more places this visit, not turned down, the box closed. */
export function keepBothCardShows(s: {
  signedOut: boolean;
  planOnScreen: boolean;
  unsaved: boolean;
  places: number;
  dismissed: boolean;
  boxOpen: boolean;
}): boolean {
  return s.signedOut && s.planOnScreen && s.unsaved && s.places >= 2 && !s.dismissed && !s.boxOpen;
}

export function keepBothDismissed(): boolean {
  return safeGet(DISMISSED, "session") === "1";
}

export function dismissKeepBoth(): void {
  safeSet(DISMISSED, "1", "session");
}

/** True the first time the card shows in the tab, so it is counted once. */
export function firstKeepBothShow(): boolean {
  if (safeGet(SHOWN, "session") === "1") return false;
  safeSet(SHOWN, "1", "session");
  return true;
}

export function markSignInFromCard(): void {
  safeSet(FROM_CARD, "1", "session");
}

/** Whether this signed-in page follows the card's Sign in; true once. */
export function takeSignInFromCard(): boolean {
  const fromCard = safeGet(FROM_CARD, "session") === "1";
  if (fromCard) safeRemove(FROM_CARD, "session");
  return fromCard;
}

export function forgetSignInFromCard(): void {
  safeRemove(FROM_CARD, "session");
}
