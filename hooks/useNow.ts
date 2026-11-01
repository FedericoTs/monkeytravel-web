import { useEffect, useState } from "react";

/**
 * Returns the current `Date` — but `null` on the server and during the
 * first client render. Updates to a real `Date` in a mount-only useEffect.
 *
 * Why this exists:
 *   Any client component that reads `new Date()` during render (directly,
 *   in a useMemo, or inside a derived value) is a hydration time-bomb on
 *   personalized SSR pages. The server picks one "now", the client picks
 *   another seconds-to-minutes later (because the SSR HTML is often CDN-
 *   cached or just chronologically later than the browser hydration),
 *   text content diverges, and React throws minified error #418.
 *
 *   The canonical fix is to defer all `new Date()` reads to *after*
 *   hydration, accepting that the very first paint won't have the
 *   time-relative result. This hook codifies that pattern so callers
 *   don't reinvent it (we hit this twice in 2026-05-30 — TripsPageClient
 *   and OngoingTripView — and would have hit it again on every new
 *   time-relative surface).
 *
 * Usage:
 *
 *   const now = useNow();
 *   const upcoming = useMemo(() => {
 *     if (!now) return [];                       // SSR-safe default
 *     return trips.filter(t => new Date(t.start) > now);
 *   }, [trips, now]);
 *
 * The `now` value is a snapshot taken on mount — it does NOT tick. If
 * you need a re-rendering clock (e.g. "5 minutes ago" countdown), pass
 * the optional `tickMs` argument:
 *
 *   const now = useNow(60_000); // refreshes every minute
 *
 * Returns null on the server / first client render, then a Date.
 */
export function useNow(tickMs?: number): Date | null {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    // Initial pass — populate immediately after first commit.
    setNow(new Date());

    if (!tickMs || tickMs <= 0) return;

    // Optional ticking interval for time-of-day-sensitive UI. We re-create
    // a new Date instance each tick (not just mutate) so referential
    // equality breaks and downstream useMemo deps fire.
    const id = setInterval(() => setNow(new Date()), tickMs);
    return () => clearInterval(id);
  }, [tickMs]);

  return now;
}
