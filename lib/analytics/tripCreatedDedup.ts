/**
 * One-time analytics-emission guard for a saved trip, keyed on the trip id.
 *
 * WHY: on the `/trips/new?auth_event=login_google` return the wizard remounts
 * and can run the save flow more than once for ONE trip. Every run emits
 * `trip_created` + `first_trip_saved` + the `saved` funnel event, outside the
 * server-side row-dedup, so without a guard one trip would count several
 * times in the activation metrics. A `useRef` resets on remount, so it can't
 * be the guard.
 *
 * This guard is module-scoped (survives component remounts within the tab,
 * unlike a `useRef`) and mirrors to `sessionStorage` (survives a hard reload
 * mid-flow). It is keyed on the server-deduped `trip.id`, which is stable
 * across every save run (the 60s row-dedup returns the same row).
 *
 * It gates ONLY the analytics emission — never the save itself (already
 * row-idempotent) or any UX side-effect.
 */

const emitted = new Set<string>();

/**
 * Atomically claim the one-time analytics emission for `tripId`.
 *
 * Returns `true` exactly once per trip id per tab session (the caller should
 * emit `trip_created` / `first_trip_saved` / the `saved` funnel event), and
 * `false` on every subsequent call for the same id (the caller should skip).
 *
 * Fails OPEN on a missing id (returns `true`) so a bug that loses the trip id
 * can never silently suppress a legitimate first-time activation event.
 */
export function claimTripCreatedEmit(tripId: string | null | undefined): boolean {
  if (!tripId) return true;
  if (emitted.has(tripId)) return false;
  emitted.add(tripId);
  if (typeof window !== "undefined") {
    try {
      const key = `tc_emitted_${tripId}`;
      if (window.sessionStorage.getItem(key)) return false; // already emitted before a reload
      window.sessionStorage.setItem(key, "1");
    } catch {
      /* storage disabled (private mode / SSR) — the in-memory Set still guards this tab */
    }
  }
  return true;
}

/** Test-only: clear the in-memory guard so suites start from a clean slate. */
export function __resetTripCreatedDedupForTests(): void {
  emitted.clear();
}
