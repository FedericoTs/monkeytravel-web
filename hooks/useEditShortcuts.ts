"use client";

import { useEffect } from "react";

/**
 * The trip editor's keyboard shortcuts, live while editing and not while
 * typing in a field: Cmd/Ctrl+Z undoes, Cmd/Ctrl+Shift+Z redoes, Cmd/Ctrl+S
 * saves when an explicit save can run, and Escape leaves edit mode when
 * nothing has changed.
 */
export function useEditShortcuts({
  editingActive,
  ambientEdit,
  hasChanges,
  isSaving,
  conflict,
  itineraryWritesInFlight,
  undo,
  redo,
  save,
  setIsEditMode,
}: {
  editingActive: boolean;
  /** A solo owner's editor, which saves by itself. */
  ambientEdit: boolean;
  hasChanges: boolean;
  isSaving: boolean;
  /** The trip changed elsewhere and the planner has yet to settle it. */
  conflict: boolean;
  itineraryWritesInFlight: number;
  undo: () => void;
  redo: () => void;
  save: () => void;
  setIsEditMode: (editing: boolean) => void;
}): void {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!editingActive) return;

      // Don't intercept when user is typing in an input/textarea
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        return;
      }

      const cmd = e.metaKey || e.ctrlKey;

      // Cmd+Z = Undo
      if (cmd && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
      // Cmd+Shift+Z = Redo
      if (cmd && e.shiftKey && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        redo();
      }
      // Cmd+S = Save. Ambient trips auto-save, so just swallow the browser's
      // Save dialog and let the debounced auto-save own persistence — saving
      // here would double-PATCH, double-count the edit metric, and pop a
      // redundant success toast next to the status pill.
      if (cmd && e.key === "s") {
        e.preventDefault();
        if (!ambientEdit && hasChanges && !isSaving && !conflict && itineraryWritesInFlight === 0) {
          save();
        }
      }
      // Escape = Exit edit mode (only if no changes; no-op for ambient)
      if (e.key === "Escape" && !hasChanges) {
        setIsEditMode(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editingActive, ambientEdit, hasChanges, isSaving, conflict, itineraryWritesInFlight, undo, redo, save, setIsEditMode]);
}
