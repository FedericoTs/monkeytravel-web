/**
 * Claimed-trip hand-off between AuthProvider and the wizard.
 *
 * AuthProvider claims a pending anonymous trip on SIGNED_IN and used to
 * discard the trip id it got back. The wizard had no way to tell the person
 * their trip had arrived, so a fresh signup sat on an empty form while the
 * trip they had just built moved silently into their account.
 *
 * Two channels, because the two sides race: SIGNED_IN usually fires during
 * hydration, BEFORE the wizard's effects subscribe. So the id is written to
 * sessionStorage (survives the race, dies with the tab) AND announced as a
 * window event (for a wizard that is already listening). Storage goes through
 * lib/safe-storage so a browser with storage blocked cannot throw here — this
 * runs inside the auth transition and must never be able to break sign-in.
 */
import { safeGet, safeRemove, safeSet } from "@/lib/safe-storage";

export const CLAIMED_TRIP_KEY = "mt_claimed_trip_id";
export const CLAIMED_TRIP_EVENT = "mt:trip-claimed";

export function publishClaimedTrip(tripId: string): void {
  safeSet(CLAIMED_TRIP_KEY, tripId, "session");
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CLAIMED_TRIP_EVENT, { detail: { tripId } }));
  }
}

/** The id announced earlier in this tab, if the wizard mounted after the claim. */
export function readClaimedTrip(): string | null {
  return safeGet(CLAIMED_TRIP_KEY, "session");
}

/** Forget it — after the wizard has shown the hand-off once. */
export function clearClaimedTrip(): void {
  safeRemove(CLAIMED_TRIP_KEY, "session");
}

/** Subscribe to claims announced after mount. Returns the unsubscribe. */
export function onClaimedTrip(cb: (tripId: string) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => {
    const id = (e as CustomEvent<{ tripId?: string }>).detail?.tripId;
    if (id) cb(id);
  };
  window.addEventListener(CLAIMED_TRIP_EVENT, handler);
  return () => window.removeEventListener(CLAIMED_TRIP_EVENT, handler);
}
