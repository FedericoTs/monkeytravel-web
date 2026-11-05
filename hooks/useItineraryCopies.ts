"use client";

import { useState } from "react";
import type { ItineraryDay } from "@/types";
import { ensureActivityIdsStable } from "@/lib/utils/activity-id";

/**
 * The trip page's copy of its plan as loaded, and the copy it edits. One copy for
 * both states, with ids derived from the stored trip for any activity stored
 * without one. Random ids would differ between the two states and between mounts,
 * so the page would look edited on its first render (a phantom autosave, or a
 * false conflict on a router-cache restore). For solo owners useItinerarySync
 * stores them once.
 */
export function useItineraryCopies(trip: { id: string; itinerary: ItineraryDay[] }) {
  const [initialItinerary] = useState(() => ensureActivityIdsStable(trip.itinerary, trip.id));
  const [editedItinerary, setEditedItinerary] = useState<ItineraryDay[]>(() =>
    JSON.parse(JSON.stringify(initialItinerary))
  );
  return { initialItinerary, editedItinerary, setEditedItinerary };
}
