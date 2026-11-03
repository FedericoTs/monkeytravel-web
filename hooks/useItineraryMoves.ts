"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEndEvent, DragOverEvent, DragStartEvent } from "@dnd-kit/core";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ui/Toast";
import { captureActivityModified } from "@/lib/posthog/events";
import { hapticSelection } from "@/lib/native/haptics";
import { applyMove, describeMove, isSameDayTarget, locateActivity } from "@/lib/trip/itinerary-dnd";
import { findActivityById, moveActivityToDay, recalculateActivityTimes } from "@/lib/utils/activity-id";
import type { ItineraryDay } from "@/types";

interface ItineraryMovesOptions {
  tripId: string;
  /** The itinerary being edited. */
  itinerary: ItineraryDay[];
  setItinerary: (next: ItineraryDay[]) => void;
  /** Records an undo entry before a change. */
  pushUndo: (action: string) => void;
  undo: () => void;
  /** Scrolls to a day and flashes it. */
  focusDay: (dayNumber: number) => void;
}

/**
 * Moving activities between days. Two ways in, one commit: drag a card across
 * days (live preview, committed on drop) or pick a day in the card's "Move to
 * another day" sheet. Both recalculate the times of the source and destination
 * days, push a single undo entry, scroll to and flash the destination day, and
 * confirm with a toast that offers Undo.
 *
 * While a card is being dragged, the days render from `preview` (the itinerary
 * with the card already moved to wherever it is hovering) instead of the
 * edited state, so the plan reflows live and what you see is what gets
 * committed on drop. Nothing is written — no undo entry, no auto-save — until
 * the drop.
 */
export function useItineraryMoves({ tripId, itinerary, setItinerary, pushUndo, undo, focusDay }: ItineraryMovesOptions) {
  const t = useTranslations("trips");
  const { addToast } = useToast();

  const [dragPreview, setDragPreview] = useState<ItineraryDay[] | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const dragStartRef = useRef<ItineraryDay[] | null>(null);
  // The preview as of the last drag-over, read synchronously, and a one-frame
  // hold after each cross-day step: the step reflows the days under the
  // pointer, and reacting to that reflow in the same frame bounced the card
  // between two days until React stopped the update loop.
  const dragPreviewRef = useRef<ItineraryDay[] | null>(null);
  const crossDayHoldRef = useRef(false);
  const firstModificationRef = useRef(true);

  // The toast's Undo fires seconds after the move, from a callback created
  // BEFORE pushUndo/setItinerary landed — so a captured `undo` would close
  // over the stack without the move and undo nothing. Always call the latest
  // one.
  const undoRef = useRef(undo);
  useEffect(() => {
    undoRef.current = undo;
  }, [undo]);

  const commitMove = useCallback(
    (
      next: ItineraryDay[],
      activityId: string,
      sourceDayIndex: number,
      targetDayIndex: number,
      method: "drag" | "menu",
    ) => {
      const targetDayNumber = next[targetDayIndex]?.day_number ?? targetDayIndex + 1;
      const sourceDayNumber = next[sourceDayIndex]?.day_number ?? sourceDayIndex + 1;
      pushUndo(`Move activity to day ${targetDayNumber}`);
      const withSourceTimes = recalculateActivityTimes(next, sourceDayIndex);
      setItinerary(recalculateActivityTimes(withSourceTimes, targetDayIndex));
      hapticSelection();
      focusDay(targetDayNumber);
      addToast(t("editActivity.movedToDay", { day: targetDayNumber }), "success", 6000, {
        label: t("detail.undo"),
        onClick: () => undoRef.current(),
      });
      captureActivityModified({
        trip_id: tripId,
        activity_id: activityId,
        modification_type: "move_day",
        is_first_modification: firstModificationRef.current,
        day_number: targetDayNumber,
        from_day_number: sourceDayNumber,
        method,
      });
      firstModificationRef.current = false;
    },
    [pushUndo, setItinerary, focusDay, addToast, t, tripId],
  );

  // The sheet path: land in the chronological slot of the chosen day, so a
  // morning activity stays a morning activity.
  const moveToDay = useCallback(
    (activityId: string, targetDayIndex: number) => {
      const location = findActivityById(itinerary, activityId);
      if (!location || location.dayIndex === targetDayIndex) return;
      const moved = moveActivityToDay(itinerary, activityId, targetDayIndex, "auto");
      if (moved === itinerary) return;
      commitMove(moved, activityId, location.dayIndex, targetDayIndex, "menu");
    },
    [itinerary, commitMove],
  );

  const onDragStart = useCallback(
    (event: DragStartEvent) => {
      dragStartRef.current = itinerary;
      dragPreviewRef.current = itinerary;
      setDragPreview(itinerary);
      setActiveDragId(String(event.active.id));
      hapticSelection();
    },
    [itinerary],
  );

  // Cross-day steps are applied to the preview as the card is dragged over
  // another day, so its cards part to make room. Within the card's own day,
  // dnd-kit's sortable strategy already animates the reorder; the final
  // order is committed once, on drop.
  const onDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event;
    const prev = dragPreviewRef.current;
    if (!over || !prev || crossDayHoldRef.current) return;
    const activeId = String(active.id);
    if (isSameDayTarget(prev, activeId, over.id)) return;
    const activeTop = active.rect.current.translated?.top;
    const after = activeTop !== undefined && over.rect ? activeTop > over.rect.top + over.rect.height / 2 : false;
    const next = applyMove(prev, activeId, over.id, { after });
    if (next === prev) return;
    dragPreviewRef.current = next;
    setDragPreview(next);
    crossDayHoldRef.current = true;
    requestAnimationFrame(() => {
      crossDayHoldRef.current = false;
    });
  }, []);

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      const start = dragStartRef.current;
      const preview = dragPreview;
      dragStartRef.current = null;
      dragPreviewRef.current = null;
      setDragPreview(null);
      setActiveDragId(null);
      if (!start || !preview) return;

      const activeId = String(active.id);
      const settled = over ? applyMove(preview, activeId, over.id) : preview;
      const move = describeMove(start, settled, activeId);
      const from = locateActivity(start, activeId);
      const to = locateActivity(settled, activeId);
      if (!move || !from || !to) return;

      if (move.crossedDays) {
        commitMove(settled, activeId, move.sourceDayIndex, move.targetDayIndex, "drag");
        return;
      }
      if (from.index === to.index) return; // dropped where it started

      pushUndo("Reorder activities");
      setItinerary(recalculateActivityTimes(settled, move.targetDayIndex));
      hapticSelection();
    },
    [dragPreview, commitMove, pushUndo, setItinerary],
  );

  const onDragCancel = useCallback(() => {
    dragStartRef.current = null;
    dragPreviewRef.current = null;
    setDragPreview(null);
    setActiveDragId(null);
  }, []);

  // The card the DragOverlay ghost shows while dragging.
  const draggedActivity = useMemo(() => {
    if (!activeDragId) return null;
    const source = dragPreview ?? itinerary;
    const loc = locateActivity(source, activeDragId);
    return loc ? source[loc.dayIndex].activities[loc.index] : null;
  }, [activeDragId, dragPreview, itinerary]);

  return {
    /** The itinerary with the dragged card where it hovers; null when not dragging. */
    preview: dragPreview,
    /** Whether a card is being dragged. */
    dragging: activeDragId !== null,
    draggedActivity,
    moveToDay,
    onDragStart,
    onDragOver,
    onDragEnd,
    onDragCancel,
  };
}
