"use client";

import { useCallback, useEffect, useRef } from "react";
import { addIsoDaysOrThrow } from "@/lib/dates/iso-date";
import { createUndoLedger } from "@/lib/trip/assistant-undo";
import { applyAssistantEdits, type AssistantDayEdit } from "@/lib/trips/day-edit-merge";
import { foundPhotos, sameApartFromPhotos, withFoundPhotos } from "@/lib/trips/keep-place-photos";
import { withDays } from "@/lib/trips/plan-days";
import { ensureActivityIds } from "@/lib/utils/activity-id";
import type { GeneratedItinerary } from "@/types";

/**
 * The wizard assistant's edits to the plan on screen, which apply as they
 * arrive. One reply changes every day it names and, when it adds or removes
 * days, the trip's length (the end date follows, so a saved trip's auto-save
 * writes it too). The trip total is recomputed so hero, sticky, overview, export
 * and saved budget stay in sync, ids, map data and photos carry over by name
 * across the edited days (so a moved activity keeps its photo;
 * lib/trips/day-edit-merge.ts), and the first changed day scrolls into view.
 *
 * `applyEdits` returns what `undoEdits` takes to put the plan and end date back,
 * only while nothing but photos has changed the plan since
 * (lib/trip/assistant-undo.ts). Photos arrive by themselves seconds after a plan
 * changes (hooks/usePlanPhotos.ts), and the ones found since stay.
 * `hasEdits` says whether the plan on screen has edits a full regenerate would
 * discard; every generation calls `forgetEdits`.
 */
export function useAssistantEdits({
  plan,
  onPlan,
  startDate,
  endDate,
  onEndDate,
  noteEditApplied,
}: {
  plan: GeneratedItinerary | null;
  onPlan: (plan: GeneratedItinerary) => void;
  startDate: string;
  endDate: string;
  onEndDate: (endDate: string) => void;
  /** Called for each reply applied. */
  noteEditApplied: () => void;
}) {
  // Replies applied and not undone since the last generation.
  const applied = useRef(0);
  const undo = useRef(createUndoLedger<GeneratedItinerary, string>(sameApartFromPhotos));

  // Mirrored so the handlers read current values without being recreated on
  // every change. The plan is also written as an edit applies: a second reply
  // before the next render builds on the first.
  const planRef = useRef(plan);
  const startDateRef = useRef(startDate);
  const endDateRef = useRef(endDate);
  useEffect(() => { planRef.current = plan; }, [plan]);
  useEffect(() => { startDateRef.current = startDate; }, [startDate]);
  useEffect(() => { endDateRef.current = endDate; }, [endDate]);

  const applyEdits = useCallback(
    (edits: AssistantDayEdit[], tripLength?: number): string | undefined => {
      const prev = planRef.current;
      if (!prev) return undefined;
      noteEditApplied();
      applied.current += 1;
      const start = startDateRef.current;
      // Ids are given here, so the state keeps this exact object and Undo can
      // tell it is still the plan on screen.
      const days = ensureActivityIds(applyAssistantEdits(prev.days, edits, { tripLength, startDate: start || undefined }));
      const next = withDays(prev, days);
      const undoId = undo.current.record(prev, next, endDateRef.current);
      planRef.current = next;
      onPlan(next);
      if (tripLength !== undefined && start) onEndDate(addIsoDaysOrThrow(start, tripLength - 1));
      const dayNumber = edits[0]?.day_number ?? tripLength ?? 1;
      setTimeout(() => {
        const el = document.getElementById(`day-${dayNumber}`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
          el.classList.add("ring-2", "ring-[var(--primary)]");
          setTimeout(() => el.classList.remove("ring-2", "ring-[var(--primary)]"), 2000);
        }
      }, 100);
      return undoId;
    },
    [onPlan, onEndDate, noteEditApplied]
  );

  const undoEdits = useCallback(
    (undoId: string): boolean => {
      const current = planRef.current;
      const entry = current && undo.current.take(undoId, current);
      if (!current || !entry) return false;
      const restored = { ...entry.before, days: withFoundPhotos(entry.before.days, foundPhotos(current.days)) };
      planRef.current = restored;
      onPlan(restored);
      onEndDate(entry.extra);
      applied.current = Math.max(0, applied.current - 1);
      return true;
    },
    [onPlan, onEndDate]
  );

  const hasEdits = useCallback(() => applied.current > 0, []);
  const forgetEdits = useCallback(() => {
    applied.current = 0;
  }, []);

  return { applyEdits, undoEdits, hasEdits, forgetEdits };
}
