"use client";

import { useEffect, useRef } from "react";
import type { ItineraryDay } from "@/types";
import { hasStandInPhotos } from "@/lib/trips/keep-place-photos";

// Not run again this soon after the last run (trip_meta.photos_enriched_at).
const RERUN_AFTER_MS = 10 * 60_000;

/**
 * A kept trip's stand-in photos become real ones when its owner opens it:
 * photos are looked up for the plans people keep, not on each planner save.
 * `onPhotos` gets the place photos found, by activity id. Once per opened
 * trip; the itinerary is read as it was opened.
 */
export function useKeptTripPhotos(opts: {
  enabled: boolean;
  tripId: string;
  itinerary: ItineraryDay[];
  lastRun: unknown;
  onPhotos: (photos: Record<string, string>) => void;
}): void {
  const latest = useRef(opts);
  useEffect(() => {
    latest.current = opts;
  });
  const { enabled, tripId } = opts;

  useEffect(() => {
    const { itinerary, lastRun } = latest.current;
    if (!enabled || !hasStandInPhotos(itinerary)) return;
    if (Date.now() - Date.parse(String(lastRun ?? "")) < RERUN_AFTER_MS) return;
    let cancelled = false;
    fetch(`/api/trips/${tripId}/enrich-photos`, { method: "POST" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { photos?: Record<string, string> } | null) => {
        const photos = body?.photos;
        if (!cancelled && photos && Object.keys(photos).length > 0) latest.current.onPhotos(photos);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled, tripId]);
}
