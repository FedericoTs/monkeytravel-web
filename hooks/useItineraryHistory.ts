"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ItineraryDay } from "@/types";

interface HistoryEntry {
  itinerary: ItineraryDay[];
  action: string;
  timestamp: number;
}

/** Undo steps kept; older ones drop off. */
const MAX_HISTORY = 20;

/**
 * Undo and redo for the itinerary being edited. `push(action)` records the
 * itinerary as it is, before a change; `undo` and `redo` swap the current one
 * with the last snapshot, recording it the other way, then call `onNavigate`;
 * `clear` starts over, as when the plan is replaced from the server.
 */
export function useItineraryHistory(
  itinerary: ItineraryDay[],
  setItinerary: (next: ItineraryDay[]) => void,
  onNavigate: () => void
) {
  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);
  // The plan as it is now. A card that hasn't re-rendered calls the push it
  // was given at an earlier render; its snapshot must not be that render's plan.
  const latest = useRef(itinerary);
  useEffect(() => {
    latest.current = itinerary;
  }, [itinerary]);

  const clear = useCallback(() => {
    setUndoStack([]);
    setRedoStack([]);
  }, []);

  const push = useCallback((action: string) => {
    setUndoStack(prev => [...prev.slice(-MAX_HISTORY + 1), {
      itinerary: JSON.parse(JSON.stringify(latest.current)),
      action,
      timestamp: Date.now()
    }]);
    setRedoStack([]); // Clear redo stack on new action
  }, []);

  const undo = useCallback(() => {
    if (undoStack.length === 0) return;
    const last = undoStack[undoStack.length - 1];
    setRedoStack(prev => [...prev, {
      itinerary: JSON.parse(JSON.stringify(itinerary)),
      action: `Redo: ${last.action}`,
      timestamp: Date.now()
    }]);
    setItinerary(last.itinerary);
    setUndoStack(prev => prev.slice(0, -1));
    onNavigate();
  }, [undoStack, itinerary, setItinerary, onNavigate]);

  const redo = useCallback(() => {
    if (redoStack.length === 0) return;
    const last = redoStack[redoStack.length - 1];
    setUndoStack(prev => [...prev, {
      itinerary: JSON.parse(JSON.stringify(itinerary)),
      action: `Undo: ${last.action}`,
      timestamp: Date.now()
    }]);
    setItinerary(last.itinerary);
    setRedoStack(prev => prev.slice(0, -1));
    onNavigate();
  }, [redoStack, itinerary, setItinerary, onNavigate]);

  return { push, undo, redo, clear, canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 };
}
