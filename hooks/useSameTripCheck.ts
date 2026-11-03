"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { findRecentTwin, type RecentTwin } from "@/lib/trips/recent-twin";

export interface SameTripCheck {
  /** The trip this account already saved for the same place and dates. */
  twin: RecentTwin | null;
  /** Auto-save waits: the check is out, or the planner hasn't answered it. */
  awaiting: boolean;
  /** The saved trip the planner chose to update with this plan. */
  replaceTripId: string | null;
  /** The planner's answer: a trip id to update it, null to save a separate trip. */
  choose: (replaceTripId: string | null) => void;
  /** Drops the answer, so planning the same trip again asks again. */
  forget: () => void;
}

/**
 * Planning a trip again in a fresh wizard auto-saved a second copy under the
 * same name, and edits then landed on whichever copy was open. When this
 * account already saved `trip`'s place and dates, auto-save waits for the
 * planner to update that trip with this plan or save a separate one.
 *
 * `trip` is null while there is nothing to check (signed out, already saved,
 * no plan coming). The check starts with the generation, so it is answered
 * before the plan shows; `hasPlan` says whether it has.
 */
export function useSameTripCheck(
  trip: { destination: string; startDate: string; endDate: string } | null,
  hasPlan: boolean
): SameTripCheck {
  const key =
    trip && trip.destination && trip.startDate && trip.endDate
      ? JSON.stringify([trip.destination, trip.startDate, trip.endDate])
      : null;
  const [result, setResult] = useState<{ key: string; twin: RecentTwin | null } | null>(null);
  const [choice, setChoice] = useState<{ key: string; replaceTripId: string | null } | null>(null);

  useEffect(() => {
    if (!key) return;
    let current = true;
    const [destination, startDate, endDate] = JSON.parse(key) as [string, string, string];
    void (async () => {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const twin = session?.user
        ? await findRecentTwin(supabase, session.user.id, { destination, startDate, endDate })
        : null;
      if (current) setResult({ key, twin });
    })().catch(() => {
      if (current) setResult({ key, twin: null });
    });
    return () => {
      current = false;
    };
  }, [key]);

  const twin = key !== null && result?.key === key ? result.twin : null;
  return {
    twin,
    awaiting: key !== null && hasPlan && (result?.key !== key || (twin !== null && choice?.key !== key)),
    replaceTripId: key !== null && choice?.key === key ? choice.replaceTripId : null,
    choose: (replaceTripId) => {
      if (key) setChoice({ key, replaceTripId });
    },
    forget: () => setChoice(null),
  };
}
