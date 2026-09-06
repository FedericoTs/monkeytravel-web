"use client";

import { useEffect, useState } from "react";
import { computeTripDayState, type TripDayState } from "./live";

/**
 * Keep a trip's live day-state fresh on the client — Live Trip plan, Phase 3.2.
 *
 * The server computes the initial state (correct and flash-free when the trip
 * has a stored timezone). This hook then:
 *   - refines it with the viewer's own timezone when the trip has none, so a
 *     tz-less trip still opens on a plausible "today" (flagged `viewer`);
 *   - re-evaluates at the next local midnight, so a day roll-over moves Today
 *     to the next day without a reload.
 *
 * Initial state is the server value verbatim, so hydration never mismatches.
 */
export function useLiveTripState(
  initial: TripDayState,
  startDate: string,
  endDate: string,
): TripDayState {
  const [state, setState] = useState<TripDayState>(initial);

  useEffect(() => {
    const viewerTimeZone =
      typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : null;

    const recompute = () =>
      setState(
        computeTripDayState({
          startDate,
          endDate,
          timeZone: initial.timeZoneSource === "stored" || initial.timeZoneSource === "derived" ? initial.timeZone : null,
          timeZoneSource: initial.timeZoneSource === "derived" ? "derived" : "stored",
          viewerTimeZone,
        }),
      );

    recompute();

    // Schedule the next local-midnight refresh (+a few seconds of slack).
    const now = new Date();
    const nextMidnight = new Date(now);
    nextMidnight.setHours(24, 0, 5, 0);
    const timer = setTimeout(recompute, Math.max(1000, nextMidnight.getTime() - now.getTime()));
    return () => clearTimeout(timer);
    // initial is a server-computed value stable across renders for a given trip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate, initial.timeZone, initial.timeZoneSource]);

  return state;
}
