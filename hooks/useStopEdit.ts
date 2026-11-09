"use client";

import { useCallback, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import type { Activity, ItineraryDay } from "@/types";
import { addActivity, editActivity, retimedCount } from "@/lib/utils/activity-id";

/**
 * Saves a stop's edit from its card, or a stop added to a day. Either goes in
 * its time order, and a later stop moves only when it now runs into it
 * (editActivity, addActivity); when any did, a message says how many, with
 * Undo. Both start from the plan as it is now: a card that hasn't re-rendered
 * calls the handler of an earlier render.
 */
export function useStopEdit({
  itinerary,
  setItinerary,
  pushUndo,
  notifyUndoable,
}: {
  itinerary: ItineraryDay[];
  setItinerary: (next: ItineraryDay[]) => void;
  pushUndo: (label: string) => void;
  notifyUndoable: (message: string) => void;
}): {
  editStop: (activityId: string, updates: Partial<Activity>) => void;
  addStop: (dayIndex: number, activity: Activity) => void;
} {
  const t = useTranslations("trips");
  const latest = useRef(itinerary);
  useEffect(() => {
    latest.current = itinerary;
  }, [itinerary]);

  const commit = useCallback(
    (label: string, stopId: string, change: (plan: ItineraryDay[]) => ItineraryDay[]) => {
      const current = latest.current;
      const next = change(current);
      pushUndo(label);
      setItinerary(next);
      const moved = retimedCount(current, next, stopId);
      if (moved > 0) notifyUndoable(t("editActivity.madeRoom", { count: moved }));
    },
    [pushUndo, setItinerary, notifyUndoable, t]
  );

  const editStop = useCallback(
    (activityId: string, updates: Partial<Activity>) =>
      commit("Update activity", activityId, (plan) => editActivity(plan, activityId, updates)),
    [commit]
  );
  const addStop = useCallback(
    (dayIndex: number, activity: Activity) => commit("Add activity", activity.id, (plan) => addActivity(plan, dayIndex, activity)),
    [commit]
  );
  return { editStop, addStop };
}
