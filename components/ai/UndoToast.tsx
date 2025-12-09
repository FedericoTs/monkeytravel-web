"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { ItineraryDay } from "@/types";

interface UndoState {
  id: string;
  previousItinerary: ItineraryDay[];
  action: {
    type: "replace" | "add" | "remove";
    description: string;
    activityName?: string;
    dayNumber?: number;
  };
  timestamp: number;
}

interface UndoToastProps {
  undoState: UndoState | null;
  onUndo: () => void;
  onDismiss: () => void;
  // Undo persists until next action (as per user preference)
  persistUntilNextAction?: boolean;
}

export default function UndoToast({
  undoState,
  onUndo,
  onDismiss,
  persistUntilNextAction = true,
}: UndoToastProps) {
  const [isUndoing, setIsUndoing] = useState(false);
  const [showToast, setShowToast] = useState(false);

  // Show/hide toast based on undoState
  useEffect(() => {
    if (undoState) {
      setShowToast(true);
    }
  }, [undoState]);

  const handleUndo = useCallback(async () => {
    if (isUndoing || !undoState) return;

    setIsUndoing(true);
    try {
      await onUndo();
      setShowToast(false);
    } finally {
      setIsUndoing(false);
    }
  }, [isUndoing, undoState, onUndo]);

  const handleDismiss = useCallback(() => {
    setShowToast(false);
    onDismiss();
  }, [onDismiss]);

  // Get action-specific icon and text
  const getActionConfig = (type: string) => {
    switch (type) {
      case "replace":
        return {
          icon: "M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4",
          label: "Activity replaced",
          color: "from-violet-500 to-purple-500",
        };
      case "add":
        return {
          icon: "M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z",
          label: "Activity added",
          color: "from-emerald-500 to-green-500",
        };
      case "remove":
        return {
          icon: "M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16",
          label: "Activity removed",
          color: "from-rose-500 to-red-500",
        };
      default:
        return {
          icon: "M5 13l4 4L19 7",
          label: "Change applied",
          color: "from-emerald-500 to-green-500",
        };
    }
  };

  const actionConfig = undoState ? getActionConfig(undoState.action.type) : getActionConfig("default");

  return (
    <AnimatePresence>
      {showToast && undoState && (
        <motion.div
          initial={{ opacity: 0, y: 50, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.95 }}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
          className="fixed bottom-20 lg:bottom-6 left-1/2 -translate-x-1/2 z-[100]"
        >
          <div className="bg-slate-900 text-white px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-4 min-w-[300px] max-w-[90vw]">
            {/* Success icon with gradient */}
            <div className={`w-9 h-9 rounded-full bg-gradient-to-br ${actionConfig.color} flex items-center justify-center flex-shrink-0 shadow-lg`}>
              <motion.svg
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 500, delay: 0.1 }}
                className="w-5 h-5 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={actionConfig.icon} />
              </motion.svg>
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">
                {actionConfig.label}
              </p>
              {undoState.action.activityName && (
                <p className="text-xs text-slate-400 truncate">
                  {undoState.action.activityName}
                  {undoState.action.dayNumber && ` • Day ${undoState.action.dayNumber}`}
                </p>
              )}
            </div>

            {/* Undo indicator - persistent until next action */}
            {persistUntilNextAction && (
              <div className="flex items-center gap-0.5">
                <motion.div
                  animate={{ opacity: [0.5, 1, 0.5] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="w-1.5 h-1.5 rounded-full bg-emerald-400"
                />
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-2 flex-shrink-0">
              {/* Undo button */}
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleUndo}
                disabled={isUndoing}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {isUndoing ? (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                  </svg>
                )}
                <span>Undo</span>
              </motion.button>

              {/* Dismiss button */}
              <button
                onClick={handleDismiss}
                className="p-1.5 text-slate-400 hover:text-white transition-colors rounded-lg hover:bg-white/10"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Helper text */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="text-center text-[10px] text-slate-500 mt-2"
          >
            Undo available until your next change
          </motion.p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Hook for managing undo state
export function useUndoState() {
  const [undoStack, setUndoStack] = useState<UndoState[]>([]);

  const pushUndo = useCallback((state: Omit<UndoState, "id" | "timestamp">) => {
    const newState: UndoState = {
      ...state,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    };
    // Keep only the last undo state (persistent until next action)
    setUndoStack([newState]);
  }, []);

  const popUndo = useCallback(() => {
    const last = undoStack[undoStack.length - 1];
    if (last) {
      setUndoStack([]);
    }
    return last;
  }, [undoStack]);

  const clearUndo = useCallback(() => {
    setUndoStack([]);
  }, []);

  const currentUndo = undoStack[undoStack.length - 1] || null;

  return {
    currentUndo,
    pushUndo,
    popUndo,
    clearUndo,
    hasUndo: undoStack.length > 0,
  };
}

// Export types
export type { UndoState };
