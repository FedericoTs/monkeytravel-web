"use client";

import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";

/** The day card in focus, and whether its highlight pulses (not under reduced motion). */
export type FocusedDay = { day: number; pulse: boolean };

/**
 * APPLY → SEE: after the AI assistant applies a change, or when the planner
 * taps the action badge in the chat, `focusDay` scrolls the day's card
 * (`trip-day-<day number>`) into view and highlights it for ~2 s, so the
 * change has a visible anchor in the plan. It clears a day filter that would
 * hide the card, and closes the assistant where it covers the plan.
 */
export function useDayFocus({
  setSelectedDay,
  setIsAIAssistantOpen,
}: {
  setSelectedDay: Dispatch<SetStateAction<number | null>>;
  setIsAIAssistantOpen: (open: boolean) => void;
}) {
  const [aiFocusDay, setAiFocusDay] = useState<FocusedDay | null>(null);
  const aiFocusTimerRef = useRef<number | null>(null);
  const focusDay = useCallback((dayNumber: number) => {
    if (typeof window === "undefined") return;
    // A day filter would hide the target card entirely — clear it first.
    setSelectedDay((prev) => (prev !== null && prev !== dayNumber ? null : prev));
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Below lg the assistant is an 85vh bottom sheet that fully covers the
    // plan — close it, otherwise "scroll into view" is invisible. On lg+ it's
    // a 420px side panel, so the plan stays visible and the chat stays open.
    if (window.innerWidth < 1024) {
      setIsAIAssistantOpen(false);
    }
    setAiFocusDay({ day: dayNumber, pulse: !reduceMotion });
    window.setTimeout(() => {
      document.getElementById(`trip-day-${dayNumber}`)?.scrollIntoView({
        // prefers-reduced-motion: jump without animation, keep the highlight.
        behavior: reduceMotion ? "auto" : "smooth",
        block: "start",
      });
    }, 100); // let a just-refetched itinerary (version-keyed remount) commit first
    if (aiFocusTimerRef.current !== null) window.clearTimeout(aiFocusTimerRef.current);
    aiFocusTimerRef.current = window.setTimeout(() => setAiFocusDay(null), 2200);
  }, [setSelectedDay, setIsAIAssistantOpen]);

  return { focusedDay: aiFocusDay, focusDay };
}
