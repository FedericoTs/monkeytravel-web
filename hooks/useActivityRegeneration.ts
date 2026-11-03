"use client";

import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ui/Toast";
import { trackActivityRegenerated } from "@/lib/analytics";
import { replaceActivity } from "@/lib/utils/activity-id";
import type { ItineraryDay } from "@/types";

/**
 * Regenerating one activity of the trip being edited: the server suggests a
 * replacement, which takes the activity's place (keeping its id) with an undo
 * step. A refusal or failure is said in a toast and the save error, naming
 * the monthly limit when that was it. `regeneratingActivityId` is the
 * activity in flight.
 */
export function useActivityRegeneration({
  tripId,
  destination,
  itinerary,
  setItinerary,
  pushUndo,
  setSaveError,
}: {
  tripId: string;
  destination: string;
  itinerary: ItineraryDay[];
  setItinerary: Dispatch<SetStateAction<ItineraryDay[]>>;
  pushUndo: (action: string) => void;
  setSaveError: (message: string | null) => void;
}) {
  const t = useTranslations("trips");
  const { addToast } = useToast();
  const [regeneratingActivityId, setRegeneratingActivityId] = useState<string | null>(null);

  const handleActivityRegenerate = useCallback(
    async (activityId: string, dayIndex: number) => {
      setRegeneratingActivityId(activityId);
      try {
        const response = await fetch("/api/ai/regenerate-activity", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tripId,
            activityId,
            dayIndex,
            destination,
            itinerary,
          }),
        });

        const data = response.ok ? await response.json() : null;
        if (!data?.activity) {
          throw Object.assign(new Error("Failed to regenerate activity"), { status: response.status });
        }
        // Undo is offered for a change that happened: a failed attempt leaves
        // nothing to undo, and the redo stack as it was.
        pushUndo("Regenerate activity");
        setItinerary((prev) =>
          replaceActivity(prev, activityId, {
            ...data.activity,
            id: activityId,
          })
        );
        // Track activity regeneration for retention analytics
        trackActivityRegenerated({
          tripId,
          activityType: data.activity.type || "unknown",
        });
      } catch (error) {
        console.error("Error regenerating activity:", error);
        const status = (error as { status?: number } | null)?.status;
        const msg = status === 429 ? t("detail.activityRegenerateLimit") : t("detail.activityRegenerateFailed");
        setSaveError(msg);
        addToast(msg, "error");
      } finally {
        setRegeneratingActivityId(null);
      }
    },
    [tripId, destination, itinerary, pushUndo, t, setSaveError, addToast, setItinerary]
  );

  return { regeneratingActivityId, handleActivityRegenerate };
}
