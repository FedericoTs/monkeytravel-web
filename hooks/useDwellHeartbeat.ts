"use client";

import { useEffect, useEffectEvent } from "react";

/** At most this many beats: about 3 minutes of visible dwell. */
const MAX_BEATS = 18;
const INTERVAL_MS = 10_000;

/**
 * Calls `beat` every 10s while `active` and the tab is visible, at most 18
 * times: how long someone stays on a step, for sessions that leave no other
 * event. A hidden tab isn't counted, and past ~3 minutes it's a parked tab
 * rather than someone deciding, so the beats stop.
 */
export function useDwellHeartbeat(active: boolean, beat: () => void): void {
  const onBeat = useEffectEvent(beat);
  useEffect(() => {
    if (!active) return;
    let beats = 0;
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      onBeat();
      if (++beats >= MAX_BEATS) clearInterval(id);
    }, INTERVAL_MS);
    return () => clearInterval(id);
  }, [active]);
}
