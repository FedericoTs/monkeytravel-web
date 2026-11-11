"use client";

import { useEffect, useState } from "react";
import { safeGet, safeSet } from "@/lib/safe-storage";
import { rememberAssistantSeen } from "@/lib/trip/assistant-seen";

/**
 * The trip assistant for someone who has never opened it. It opens by itself
 * 2.5 s into the visit, its trigger pulses until it has been opened once
 * (`hasSeenAssistant` false), and the docked panel's column is kept from the
 * first paint (`assistantDockReserved`). Opening it, by itself or by hand,
 * records it in this browser's storage and cookie. `openedItself` says it
 * opened by itself in this visit, so the page asks nothing else in it.
 */
export function useAssistantFirstVisit({
  canUseAssistant,
  assistantSeen,
  isAIAssistantOpen,
  setIsAIAssistantOpen,
}: {
  canUseAssistant: boolean;
  /** The request carried the cookie of a browser that has opened the assistant. */
  assistantSeen: boolean;
  isAIAssistantOpen: boolean;
  setIsAIAssistantOpen: (open: boolean) => void;
}) {
  // On a first visit the docked panel's column is laid out from the first
  // paint and the auto-opened panel slides into it, so the plan never
  // narrows under the reader. Once the panel opens, its own state holds it.
  const [assistantDockReserved, setAssistantDockReserved] = useState(canUseAssistant && !assistantSeen);
  // The AI assistant is the core feature (the "make Day 2 cheaper" loop), so
  // it auto-opens on the user's first trip visit and its trigger pulses until
  // it has been opened once. After that, no nags.
  const [hasSeenAssistant, setHasSeenAssistant] = useState<boolean>(true);
  const [openedItself, setOpenedItself] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !canUseAssistant) return;
    if (assistantSeen || safeGet("mt_ai_assistant_seen")) {
      // Seen on this device before the cookie existed: record it there too.
      if (!assistantSeen) {
        rememberAssistantSeen();
        setAssistantDockReserved(false);
      }
      return;
    }
    // First-time visitor to any trip — surface the assistant after a brief
    // delay so they've had a moment to scan the itinerary first.
    setHasSeenAssistant(false);
    const t = setTimeout(() => {
      setIsAIAssistantOpen(true);
      setOpenedItself(true);
    }, 2500);
    return () => clearTimeout(t);
  }, [canUseAssistant, assistantSeen, setIsAIAssistantOpen]);
  // Mark as seen whenever the assistant opens — both auto-open and manual.
  useEffect(() => {
    if (isAIAssistantOpen && typeof window !== "undefined") {
      safeSet("mt_ai_assistant_seen", String(Date.now()));
      rememberAssistantSeen();
      setHasSeenAssistant(true);
      setAssistantDockReserved(false);
    }
  }, [isAIAssistantOpen]);

  return { hasSeenAssistant, assistantDockReserved, openedItself };
}
