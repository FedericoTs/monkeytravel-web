"use client";

import { useCallback, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ui/Toast";

/**
 * A message for a change the traveller can take back: what changed, with an
 * Undo. The toast stays up for seconds while the page re-renders, so its Undo
 * calls the undo current when it is clicked, not the one of the render that
 * showed it.
 */
export function useUndoToast(undo: () => void): (message: string) => void {
  const t = useTranslations("trips");
  const { addToast } = useToast();
  const undoRef = useRef(undo);
  useEffect(() => {
    undoRef.current = undo;
  }, [undo]);

  return useCallback(
    (message: string) => {
      addToast(message, "success", 6000, { label: t("detail.undo"), onClick: () => undoRef.current() });
    },
    [addToast, t]
  );
}
