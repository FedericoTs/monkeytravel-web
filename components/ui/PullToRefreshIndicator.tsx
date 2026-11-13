"use client";

import { Spinner } from "@/components/ui/Spinner";

/**
 * Visual indicator for usePullToRefresh.
 *
 * Renders a fixed-position spinner at the top of the viewport that
 * translates downward as the user pulls. Mimics the canonical iOS
 * pull-to-refresh visual that every Mail / Twitter / Booking user
 * recognizes — arrow rotates from down (encouraging pull) to up
 * (release-to-refresh) as the threshold is crossed.
 *
 * Renders NOTHING when pullDistance is 0 AND not refreshing, so it
 * costs zero paint on the static page state.
 */
interface PullToRefreshIndicatorProps {
  /** Current drag distance in pixels (from usePullToRefresh). */
  distance: number;
  /** Whether the refresh callback is currently in flight. */
  isRefreshing: boolean;
  /** Threshold the user must cross to trigger refresh. Default 80. */
  threshold?: number;
}

export function PullToRefreshIndicator({
  distance,
  isRefreshing,
  threshold = 80,
}: PullToRefreshIndicatorProps) {
  // Hide entirely when neither pulling nor refreshing — keeps the DOM
  // tree thin on the static page and means the fixed-position element
  // doesn't intercept any scroll/pointer events when idle.
  if (distance === 0 && !isRefreshing) return null;

  // Arrow rotation: 0deg at 0% threshold (pointing down), -180deg at
  // 100% threshold (pointing up — "release to refresh"). After release
  // the spinner takes over so the arrow direction stops mattering.
  const progress = Math.min(distance / threshold, 1);
  const arrowRotation = progress * -180;
  // Indicator fades in as the user pulls so it doesn't feel jarring
  // when it suddenly appears at touchstart.
  const opacity = Math.min(distance / 30, 1);

  return (
    <div
      className="fixed top-0 left-0 right-0 flex justify-center pointer-events-none z-[60]"
      style={{
        // Translate the wrapper so the indicator follows the finger.
        // The fixed-position parent stays at top: 0 so SR users don't
        // see it floating mid-page.
        transform: `translateY(${distance}px)`,
        // Smooth snap-back when the user releases below threshold.
        // No transition while pulling so the finger and indicator
        // stay perfectly in sync.
        transition: isRefreshing || distance === 0
          ? "transform 200ms cubic-bezier(0.4, 0, 0.2, 1)"
          : "none",
        opacity,
      }}
      aria-hidden="true"
    >
      <div className="mt-2 w-10 h-10 rounded-full bg-white shadow-lg flex items-center justify-center border border-slate-200">
        {isRefreshing ? (
          // Spinner while the callback runs.
          <Spinner className="w-5 h-5 text-[var(--primary)]" />
        ) : (
          // Arrow rotates as the user pulls — visual "release to
          // refresh" affordance Apple's HIG calls out as the
          // expected control.
          <svg
            className="w-5 h-5 text-slate-600"
            style={{
              transform: `rotate(${arrowRotation}deg)`,
              transition: "transform 150ms ease-out",
            }}
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 14l-7 7m0 0l-7-7m7 7V3"
            />
          </svg>
        )}
      </div>
    </div>
  );
}
