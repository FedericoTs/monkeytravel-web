"use client";

import { useEffect, useRef } from "react";
import type { ItineraryDay } from "@/types";
import { applyPlaceChanges, type PlaceChange } from "@/lib/places/kept-trip";

/**
 * A kept diet trip's places to eat are looked up when its owner first opens
 * it (app/api/trips/[id]/places-to-eat). The server stores what changed, and
 * the page makes the same changes to its own copy. It runs as one of this
 * tab's server writes (useItinerarySync): edits made meanwhile are saved
 * first or kept. Once per opened trip, and only when the check is due.
 */
export function useKeptTripPlacesToEat(opts: {
  due: boolean;
  tripId: string;
  runItineraryWrite: <T>(task: () => Promise<T>, options?: { keepsLocalEdits?: boolean }) => Promise<T>;
  adoptDayWrite: (splice: (it: ItineraryDay[]) => ItineraryDay[], from: number | null, to: number | null) => Promise<void>;
}): void {
  const latest = useRef(opts);
  useEffect(() => {
    latest.current = opts;
  });
  // The trip a check was asked for: never twice for one open.
  const askedFor = useRef<string | null>(null);
  const { due, tripId } = opts;

  useEffect(() => {
    if (!due || askedFor.current === tripId) return;
    askedFor.current = tripId;
    const { runItineraryWrite, adoptDayWrite } = latest.current;
    runItineraryWrite(
      async () => {
        const res = await fetch(`/api/trips/${tripId}/places-to-eat`, { method: "POST" });
        if (!res.ok) return;
        const body = (await res.json()) as {
          status?: string;
          changes?: PlaceChange[];
          fromVersion?: number;
          itineraryVersion?: number;
        };
        const changes = body.status === "checked" ? body.changes ?? [] : [];
        if (changes.length === 0) return;
        await adoptDayWrite((it) => applyPlaceChanges(it, changes), body.fromVersion ?? null, body.itineraryVersion ?? null);
      },
      { keepsLocalEdits: true }
    ).catch(() => {});
  }, [due, tripId]);
}
