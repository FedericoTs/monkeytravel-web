"use client";

import { useEffect, useRef, useState } from "react";
import type { ItineraryDay } from "@/types";
import { applyPlaceChanges, type PlaceChange, type PlacesToEatNote } from "@/lib/places/kept-trip";

/**
 * A kept trip's places to eat are looked up when its owner first opens it
 * (app/api/trips/[id]/places-to-eat). The server stores what changed, and the
 * page makes the same changes to its own copy. It runs as one of this tab's
 * server writes (useItinerarySync): edits made meanwhile are saved first or
 * kept. Once per opened trip, and only when the check is due. Answers what the
 * page says of a check made just now.
 */
export function useKeptTripPlacesToEat(opts: {
  due: boolean;
  tripId: string;
  runItineraryWrite: <T>(task: () => Promise<T>, options?: { keepsLocalEdits?: boolean }) => Promise<T>;
  adoptDayWrite: (splice: (it: ItineraryDay[]) => ItineraryDay[], from: number | null, to: number | null) => Promise<void>;
}): PlacesToEatNote | null {
  const latest = useRef(opts);
  useEffect(() => {
    latest.current = opts;
  });
  // The trip a check was asked for: never twice for one open.
  const askedFor = useRef<string | null>(null);
  const [note, setNote] = useState<PlacesToEatNote | null>(null);
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
          note?: PlacesToEatNote;
        };
        if (body.status !== "checked") return;
        if (body.note && body.note.checked > 0) setNote(body.note);
        const changes = body.changes ?? [];
        if (changes.length === 0) return;
        await adoptDayWrite((it) => applyPlaceChanges(it, changes), body.fromVersion ?? null, body.itineraryVersion ?? null);
      },
      { keepsLocalEdits: true }
    ).catch(() => {});
  }, [due, tripId]);

  return note;
}
