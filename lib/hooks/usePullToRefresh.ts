"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Pull-to-refresh hook — the canonical mobile gesture every iOS user
 * trained on Mail / Twitter / Booking / Airbnb expects on any scrollable
 * list. Implemented in pure DOM events (no native plugin) so it works
 * identically in the WebView and on mobile web.
 *
 * Why custom instead of `@capacitor-community/pull-to-refresh`:
 *   - Community plugin requires an Ionic `<IonRefresher>` wrapper that
 *     drags the rest of Ionic's heavyweight component layer into our
 *     bundle. We need the gesture, not the design system.
 *   - Pure DOM works in the regular mobile browser too — desktop Safari
 *     users on iPad get pull-to-refresh without a separate code path.
 *
 * Behavior:
 *   - Activates ONLY when scrollY is exactly 0 AND the user pulls down.
 *     Scrolling up from anywhere else doesn't trigger.
 *   - Threshold of ~80px (configurable). Below threshold = no fire.
 *   - During pull, the indicator translates with the finger (visual
 *     feedback that says "the gesture is recognized").
 *   - On release past threshold, fires the async callback and shows a
 *     spinner until it resolves. Disabled during refresh to prevent
 *     re-triggering.
 *   - preventDefault on touchmove ONLY when pulling down + already at
 *     top, so normal scroll isn't blocked.
 *
 * Caveats:
 *   - touchmove can't be passive (we need preventDefault). On Chrome
 *     this surfaces a console warning unless we mark explicitly:
 *     `addEventListener('touchmove', fn, { passive: false })` — which
 *     we do below.
 *   - On desktop browsers without touch events the hook is a complete
 *     no-op (the listeners never fire).
 *
 * Usage:
 *   const { isRefreshing, pullDistance, isPulling } = usePullToRefresh(
 *     async () => { await router.refresh(); },
 *     { threshold: 80 }
 *   );
 *   <PullToRefreshIndicator distance={pullDistance} isRefreshing={isRefreshing} threshold={80} />
 *   ...rest of page
 */
interface UsePullToRefreshOptions {
  /** Pixels the user must drag past before release triggers the refresh. Default 80. */
  threshold?: number;
  /** Max pixels the indicator visually travels (so users feel resistance past threshold). Default 1.5× threshold. */
  maxDistance?: number;
  /** Set to false to disable the gesture entirely (e.g. during a different active gesture). Default true. */
  enabled?: boolean;
}

interface UsePullToRefreshState {
  /** True while the async callback is in flight. UI should show a spinner. */
  isRefreshing: boolean;
  /** Current drag distance in pixels. 0 when not pulling. Use for indicator translateY. */
  pullDistance: number;
  /** True between touchstart-at-top and touchend, even if user hasn't crossed threshold yet. Useful for showing the indicator vs hiding it. */
  isPulling: boolean;
}

export function usePullToRefresh(
  onRefresh: () => Promise<void> | void,
  options: UsePullToRefreshOptions = {}
): UsePullToRefreshState {
  const { threshold = 80, enabled = true } = options;
  const maxDistance = options.maxDistance ?? threshold * 1.5;

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [isPulling, setIsPulling] = useState(false);

  // Refs hold mutable state that listeners read without re-subscribing.
  // useState alone would force the effect to re-run on every drag pixel,
  // and stale-closure issues would lose the start coordinate mid-gesture.
  const startYRef = useRef(0);
  const pullingRef = useRef(false);
  const refreshingRef = useRef(false);
  const distanceRef = useRef(0);
  // Tracks whether the current drag has already crossed `threshold` so
  // we fire the haptic tick exactly once per crossing — not on every
  // touchmove past it. Reset on release AND when the user oscillates
  // back below threshold, so a downward → upward → downward pull fires
  // again on the second crossing. Matches the iOS Mail / Safari pattern.
  const crossedThresholdRef = useRef(false);

  // Keep refs in sync with their state mirrors. Listeners read refs;
  // React renders read state. Two surfaces, one truth.
  refreshingRef.current = isRefreshing;
  distanceRef.current = pullDistance;

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    // Skip when running on a device with no touch — saves listener
    // overhead on the desktop web fallback.
    if (!("ontouchstart" in window)) return;

    const handleTouchStart = (e: TouchEvent) => {
      // Only arm the gesture when the page is scrolled to the very top
      // AND no refresh is already running. Anywhere else, leave normal
      // scroll behavior alone.
      if (window.scrollY > 0 || refreshingRef.current) return;
      startYRef.current = e.touches[0].clientY;
      pullingRef.current = true;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!pullingRef.current || refreshingRef.current) return;

      const delta = e.touches[0].clientY - startYRef.current;
      // Negative delta = user is scrolling UP (e.g. swiping toward
      // viewport bottom). Don't treat that as a pull — let the browser
      // do its thing.
      if (delta <= 0) {
        pullingRef.current = false;
        setIsPulling(false);
        setPullDistance(0);
        return;
      }

      // Damped curve: 1px finger movement past threshold = 0.4px visual,
      // so users feel resistance and the indicator doesn't fly off screen.
      const damped = delta > threshold
        ? threshold + (delta - threshold) * 0.4
        : delta;
      const clamped = Math.min(damped, maxDistance);

      setIsPulling(true);
      setPullDistance(clamped);

      // Canonical iOS pattern: tick the haptic the moment the user
      // crosses the release threshold during the drag, NOT after the
      // refresh completes. Tells the user "let go now to fire" without
      // requiring them to look at the spinner. Dynamic-imported so the
      // @capacitor/haptics plugin stays out of the web bundle — same
      // pattern as lib/usage-limits/check.ts's lazy Sentry import.
      if (damped >= threshold && !crossedThresholdRef.current) {
        crossedThresholdRef.current = true;
        import("@/lib/native/haptics")
          .then((h) => h.hapticLight())
          .catch(() => {
            /* haptics best-effort; web no-op anyway */
          });
      } else if (damped < threshold && crossedThresholdRef.current) {
        // User pulled past threshold then drifted back — arm again so a
        // second crossing also ticks. Matches Apple's Mail behavior.
        crossedThresholdRef.current = false;
      }

      // Only block default scroll if we're actually pulling down AT the
      // top. Without preventDefault iOS Safari triggers its own bounce
      // and the gesture feels fighty.
      if (delta > 5) {
        e.preventDefault();
      }
    };

    const handleTouchEnd = async () => {
      if (!pullingRef.current || refreshingRef.current) return;
      pullingRef.current = false;
      // Re-arm the threshold-crossing haptic for the next gesture so a
      // second pull also gets its tick. Without this reset, a user who
      // pulls past threshold, releases, then immediately pulls again
      // would never feel the second confirmation tap.
      crossedThresholdRef.current = false;
      setIsPulling(false);

      const distance = distanceRef.current;

      if (distance >= threshold) {
        setIsRefreshing(true);
        // Keep the indicator at threshold during the spinner so the
        // visual stays in place instead of snapping back, then jerking
        // out when the refresh completes.
        setPullDistance(threshold);
        try {
          await onRefresh();
        } catch (err) {
          // Don't swallow silently — caller may have shown an error
          // already, but log so we notice in console during dev.
          // eslint-disable-next-line no-console
          console.error("[usePullToRefresh] refresh callback threw:", err);
        } finally {
          setIsRefreshing(false);
          setPullDistance(0);
        }
      } else {
        // Below threshold — snap back without firing.
        setPullDistance(0);
      }
    };

    // touchmove MUST be non-passive so preventDefault actually blocks
    // the default scroll. The browser warns about scroll-blocking
    // touchmove listeners but this is the intended use.
    document.addEventListener("touchstart", handleTouchStart, { passive: true });
    document.addEventListener("touchmove", handleTouchMove, { passive: false });
    document.addEventListener("touchend", handleTouchEnd, { passive: true });
    document.addEventListener("touchcancel", handleTouchEnd, { passive: true });

    return () => {
      document.removeEventListener("touchstart", handleTouchStart);
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", handleTouchEnd);
      document.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [enabled, threshold, maxDistance, onRefresh]);

  return { isRefreshing, pullDistance, isPulling };
}
