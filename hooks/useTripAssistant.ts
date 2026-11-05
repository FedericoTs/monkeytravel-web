"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { AssistantCard, ItineraryDay } from "@/types";
import type { LoadingStage } from "@/components/ai/StagedLoadingIndicator";
import { useUndoState } from "@/components/ai/UndoToast";
import { buildApplyBody, type TripAssistantChange } from "@/lib/ai/assistant/pending-change";
import { assistantErrorMessage } from "@/lib/ai/assistant/error-message";
import { displayCurrencyFor } from "@/lib/ai/assistant/plan-costs";
import { trackAIAssistantMessage } from "@/lib/analytics";
import { useLocale as useLocalePrefs } from "@/lib/locale";
import { captureAIAssistantUsed } from "@/lib/posthog/events";
import { ItineraryWriteBlockedError } from "@/lib/trips/itinerary-sync";

export interface Message {
  role: "user" | "assistant";
  content: string;
  cards?: AssistantCard[];
  action?: {
    type: string;
    applied: boolean;
    activityId?: string;
    dayNumber?: number;
    // Set from the /apply response's action metadata so the badge can name
    // the activity without ever parsing model prose.
    activityName?: string;
    // apply_draft: number of revised days — drives the "{count} days
    // updated" badge (metadata-derived, like everything else here).
    dayCount?: number;
  };
  timestamp: string;
  // Client-generated notes (cancel/undo confirmations) that never hit the
  // assistant API — they carry no action metadata, so the deterministic
  // action badge must not render a "no changes" line under them.
  local?: boolean;
  // "Not saved yet: tap …", from the server beside the reply (showsPendingNote).
  pendingNote?: string;
}

/**
 * Did the user just say yes?
 *
 * Only consulted while a proposal card is on screen showing exactly what will
 * be saved, so a match is the user's stated intent rather than a guess about
 * it. Deliberately narrow: whole-message agreement only, so "yes but make it
 * cheaper" or "ok what about Tuesday" fall through to the assistant instead of
 * silently writing something the user was still negotiating.
 *
 * Covers the four languages the app ships. Anything unmatched is simply
 * treated as a normal message — the cost of a miss is one extra tap, the cost
 * of a false match is an unwanted edit.
 */
export function isAffirmative(text: string): boolean {
  const t = text
    .trim()
    .toLowerCase()
    .replace(/[.!¡¿?,;:]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return [
    // en
    "yes", "yes please", "yep", "yeah", "yup", "ok", "okay", "k", "sure",
    "do it", "do that", "go ahead", "please do", "apply", "apply it",
    "save", "save it", "add it", "confirm", "confirmed", "sounds good",
    "looks good", "perfect", "great", "yes do it", "yes please do it",
    // es
    "si", "sí", "sí por favor", "si por favor", "vale", "de acuerdo",
    "hazlo", "aplicalo", "aplícalo", "guardalo", "guárdalo", "confirmar",
    "perfecto", "genial",
    // it
    "sì", "si grazie", "sì grazie", "va bene", "fallo", "applica",
    "salva", "salvalo", "conferma", "perfetto",
    // pt
    "sim", "sim por favor", "claro", "pode ser", "faz isso", "faça isso",
    "guarda", "guardar", "confirmar", "perfeito", "ótimo", "otimo",
  ].includes(t);
}

/** An error whose message is written for the traveller; any other shows a generic one. */
class ShownError extends Error {}

/**
 * The trip assistant's conversation: what is asked and answered, the change a
 * turn prepared and its three ways on (apply, another try, cancel), and its undo.
 * The panel (components/ai/AIAssistantEnhanced.tsx) shows it.
 */
export function useTripAssistant({
  tripId,
  itinerary,
  isOpen,
  onRefetchTrip,
  onFocusDay,
  runItineraryWrite,
}: {
  tripId: string;
  itinerary: ItineraryDay[];
  isOpen: boolean;
  onRefetchTrip?: () => Promise<void>;
  onFocusDay?: (dayNumber: number) => void;
  runItineraryWrite?: <T>(task: () => Promise<T>) => Promise<T>;
}) {
  const run = useCallback(
    <T,>(task: () => Promise<T>): Promise<T> => (runItineraryWrite ? runItineraryWrite(task) : task()),
    [runItineraryWrite]
  );
  const t = useTranslations("common.ai.assistant");
  // The catalog's message for a failed response, else `fallback`.
  const failure = useCallback(
    (status: number, body: unknown, fallback: string) => {
      const m = assistantErrorMessage(status, body);
      return new ShownError(m ? t(`errors.${m.key}`, m.values) : fallback);
    },
    [t]
  );
  const { preferences, exchangeRates } = useLocalePrefs();


  // Core state
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usageInfo, setUsageInfo] = useState<{
    remainingRequests: number;
    model: string;
  } | null>(null);

  // Enhanced state for new features
  const [loadingStage, setLoadingStage] = useState<LoadingStage>("parsing");
  const [pendingChange, setPendingChange] = useState<TripAssistantChange | null>(null);
  const [isApplyingChange, setIsApplyingChange] = useState(false);

  // Undo state management
  const { currentUndo, pushUndo, clearUndo } = useUndoState();

  // Load existing conversation. Only on opening: one cleared while open stays cleared.
  useEffect(() => {
    if (!isOpen || !tripId || conversationId) return;
    (async () => {
      try {
        const res = await fetch(`/api/ai/assistant?tripId=${tripId}`);
        const data = await res.json();

        if (data.conversations && data.conversations.length > 0) {
          const latestConvo = data.conversations[0];
          setConversationId(latestConvo.id);
          setMessages(latestConvo.messages || []);
        }
      } catch (err) {
        console.error("Failed to load conversation:", err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, tripId]);

  // Simulate loading stages for better UX
  const simulateLoadingStages = useCallback(() => {
    const stages: LoadingStage[] = ["parsing", "finding", "generating", "applying"];
    let currentIndex = 0;

    const interval = setInterval(() => {
      currentIndex++;
      if (currentIndex < stages.length) {
        setLoadingStage(stages[currentIndex]);
      }
    }, 800);

    return () => clearInterval(interval);
  }, []);

  /**
   * Lets sendMessage invoke the apply handler (declared below it) without
   * reordering two large callbacks. Kept current by an effect rather than
   * written during render, which React forbids.
   */
  const applyPendingRef = useRef<null | (() => Promise<void>)>(null);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || isLoading) return;

      // A proposal is on screen. What happens next used to be: it is destroyed,
      // silently, with no note in the transcript — triggered by the single most
      // likely thing a person does when an assistant offers them something,
      // which is to reply to it. They type "yes", the assistant answers "yes"
      // agreeably, the conversation reads as an agreed change, and nothing was
      // ever written. Compare handleCancelChange, which at least says so: the
      // destructive path was the quiet one.
      if (pendingChange && !isApplyingChange) {
        if (isAffirmative(content)) {
          // Treat it as the tap they meant. The card is right there showing
          // exactly what will be saved, so this is their stated intent, not a
          // guess about it.
          setInput("");
          setMessages((prev) => [
            ...prev,
            { role: "user", content: content.trim(), timestamp: new Date().toISOString() },
          ]);
          await applyPendingRef.current?.();
          return;
        }
        // Not an agreement: the proposal is going away, so SAY that it has.
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: t("cancelledMessage"),
            timestamp: new Date().toISOString(),
            local: true,
          },
        ]);
      }

      setPendingChange(null);
      clearUndo();

      setError(null);
      const userMessage: Message = {
        role: "user",
        content: content.trim(),
        timestamp: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, userMessage]);
      setInput("");
      setIsLoading(true);
      setLoadingStage("parsing");
      const assistantStartedAt = Date.now();

      // Start loading stage simulation
      const stopStages = simulateLoadingStages();

      try {
        const res = await fetch("/api/ai/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tripId,
            message: content.trim(),
            conversationId,
            itinerary,
            // So figures in the answer match the prices on the page.
            display: displayCurrencyFor(itinerary, preferences?.preferredCurrency, exchangeRates),
          }),
        });

        stopStages();
        setLoadingStage("complete");

        const data = await res.json().catch(() => null);

        if (!res.ok || !data) {
          throw failure(res.status, data, t("error"));
        }

        if (data.conversationId && !conversationId) {
          setConversationId(data.conversationId);
        }

        // Track AI assistant usage — GA4 (legacy) AND PostHog. The dual-write
        // is a regression guard: the shipped AIAssistant already writes to
        // PostHog; without this the agent goes dark in the tool we use for all
        // funnel/activation analysis when this component is promoted.
        trackAIAssistantMessage({
          tripId,
          messageLength: content.trim().length,
        });
        // Only emit the PostHog "used" event for COMPLETED outcomes here —
        // a chat answer (no pending change). When the
        // assistant PROPOSES a change (data.pendingChange), the outcome is
        // decided later: handleApplyChange emits the definitive applied event
        // on confirm, and a cancel is a non-event. This keeps ai_assistant_used
        // from double-firing (a false action_applied:false on every proposal).
        if (!data.pendingChange) {
          void captureAIAssistantUsed({
            trip_id: tripId,
            message_length: content.trim().length,
            surface: "trip_detail",
            action_applied: !!data.message?.action?.applied,
            action_type: data.message?.action?.type,
            response_time_ms: Date.now() - assistantStartedAt,
          });
        }

        // A prepared change waits on its card for the user's confirm; the
        // route never saves one itself.
        if (data.pendingChange) {
          setPendingChange(data.pendingChange);
          // Add assistant message without the "applied" indicator
          const assistantMsg = {
            ...data.message,
            action: { ...data.message.action, applied: false },
          };
          setMessages((prev) => [...prev, assistantMsg]);
        } else {
          setMessages((prev) => [...prev, data.message]);
        }

        setUsageInfo({
          // The route emits `usage.remaining` (not `remainingRequests`); the
          // old key left the header request-count pill permanently blank.
          remainingRequests: data.usage?.remaining ?? 0,
          model: data.model || "unknown",
        });

      } catch (err) {
        setError(err instanceof ShownError ? err.message : t("error"));
        setMessages((prev) => prev.slice(0, -1));
        // Back in the box, so nothing has to be typed again.
        setInput(content.trim());
      } finally {
        setIsLoading(false);
      }
    },
    [tripId, conversationId, isLoading, itinerary, simulateLoadingStages, clearUndo, pendingChange, isApplyingChange, t, failure, preferences, exchangeRates, setInput]
  );

  // Apply pending change
  const handleApplyChange = useCallback(async () => {
    if (!pendingChange || isApplyingChange) return;

    setIsApplyingChange(true);

    try {
      // In the trip page's save queue: its pending edits are saved first, and
      // the refetch below adopts the new itinerary with its version.
      await run(async () => {
      // Save current state for undo
      const previousItinerary = JSON.parse(JSON.stringify(itinerary));

      // The conversation id lets a reload tell an applied change from an
      // abandoned one. A multi-day draft keys on its first changed day,
      // here and for the focus and badge below.
      const applyBody = buildApplyBody(pendingChange, { tripId, conversationId });
      const appliedDayNumber = applyBody.dayNumber;

      const res = await fetch("/api/ai/assistant/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(applyBody),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data) {
        throw failure(res.status, data, t("errors.applyFailed"));
      }

      // Update the last message to show "applied". Thread the /apply
      // response's action metadata (type, dayNumber, activityName) into the
      // message so the deterministic badge is rendered from the logged
      // action, never from the model's narration (one transcript narrated
      // "a new Day 12" while the logged action was Day 1).
      //
      // add_day recomputes its day number server-side against the STORED
      // trip (a stale preview must not append a duplicate day_number), so
      // prefer the /apply response's dayNumber when present.
      const confirmedDayNumber =
        typeof data.action?.dayNumber === "number"
          ? data.action.dayNumber
          : appliedDayNumber;
      setMessages((prev) =>
        prev.map((msg, idx) =>
          idx === prev.length - 1 && msg.role === "assistant"
            ? {
                ...msg,
                action: {
                  type: msg.action?.type ?? pendingChange.type,
                  activityId: msg.action?.activityId,
                  applied: true,
                  dayNumber: confirmedDayNumber,
                  activityName:
                    msg.action?.activityName ?? data.action?.activityName,
                  // "{count} days updated" badge for the bulk draft action
                  dayCount:
                    pendingChange.type === "apply_draft"
                      ? pendingChange.days.length
                      : msg.action?.dayCount,
                },
              }
            : msg
        )
      );

      // What the change did, in the traveller's language: the undo toast and
      // the "reverted" note show it.
      const undoDescription =
        pendingChange.type === "add_day"
          ? t("undoActions.addedDay", { number: confirmedDayNumber })
          : t("undoActions.updatedDays", { count: pendingChange.days.length });

      // Set up undo
      pushUndo({
        previousItinerary,
        // add_day, and apply_draft adding days, also extended trips.end_date —
        // the undo must restore it together with the itinerary (see
        // /api/ai/assistant/undo).
        previousEndDate: pendingChange.previousEndDate,
        appliedVersion: typeof data.itineraryVersion === "number" ? data.itineraryVersion : undefined,
        action: {
          type: pendingChange.type,
          description: undoDescription,
          activityName: pendingChange.type === "add_day" ? pendingChange.day.theme : undefined,
          dayNumber: confirmedDayNumber,
        },
      });

      // The confirm-first "value moment": an edit was actually committed.
      // Emit a PostHog event so applied edits are measurable distinctly from
      // proposals (proposals carry action_applied:false on the send event).
      void captureAIAssistantUsed({
        trip_id: tripId,
        message_length: 0,
        surface: "trip_detail",
        action_applied: true,
        action_type: pendingChange.type,
      });

      // Clear pending and refetch
      setPendingChange(null);
      if (onRefetchTrip) {
        await onRefetchTrip();
      }
      // APPLY → SEE loop: scroll + flash the day card that just changed
      // (transcripts: "I don't see it on the right"). For apply_draft this
      // is the FIRST changed day; for add_day the freshly appended one.
      onFocusDay?.(confirmedDayNumber);
      });
    } catch (err) {
      setError(err instanceof ShownError || err instanceof ItineraryWriteBlockedError ? err.message : t("errors.applyFailed"));
    } finally {
      setIsApplyingChange(false);
    }
  }, [pendingChange, isApplyingChange, tripId, itinerary, pushUndo, onRefetchTrip, onFocusDay, conversationId, run, failure, t]);

  useEffect(() => {
    applyPendingRef.current = handleApplyChange;
  }, [handleApplyChange]);

  // Try different suggestion
  const handleTryDifferent = useCallback(() => {
    setPendingChange(null);
    // Re-send the last user message with a "try different" modifier
    const lastUserMessage = messages.filter((m) => m.role === "user").pop();
    if (lastUserMessage) {
      sendMessage(t("tryDifferent", { message: lastUserMessage.content }));
    }
  }, [messages, sendMessage, t]);

  // Cancel pending change
  const handleCancelChange = useCallback(() => {
    setPendingChange(null);
    // Add a note that the change was cancelled
    const cancelMessage: Message = {
      role: "assistant",
      content: t("cancelledMessage"),
      timestamp: new Date().toISOString(),
      local: true, // client note — no action metadata, skip the badge
    };
    setMessages((prev) => [...prev, cancelMessage]);
  }, [t]);

  // Handle undo
  const handleUndo = useCallback(async () => {
    if (!currentUndo) return;

    try {
      // In the trip page's save queue, like apply.
      await run(async () => {
        const res = await fetch("/api/ai/assistant/undo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tripId,
            previousItinerary: currentUndo.previousItinerary,
            // add_day undos also roll trips.end_date back (see /undo route)
            previousEndDate: currentUndo.previousEndDate,
            expectedVersion: currentUndo.appliedVersion,
          }),
        });

        if (!res.ok) {
          // 409: the trip moved on after the change, and undoing it would wipe that.
          if (res.status === 409) throw new ShownError(t("errors.undoOutdated"));
          throw failure(res.status, await res.json().catch(() => null), t("errors.undoFailed"));
        }

        // Clear undo and refetch
        clearUndo();
        if (onRefetchTrip) {
          await onRefetchTrip();
        }
      });

      // Add confirmation message
      const undoMessage: Message = {
        role: "assistant",
        content: t("undoSuccess"),
        cards: [
          {
            type: "confirmation",
            icon: "check",
            title: t("undoTitle"),
            description: t("undoDescription", { action: currentUndo.action.description }),
          },
        ],
        timestamp: new Date().toISOString(),
        local: true, // client note — no action metadata, skip the badge
      };
      setMessages((prev) => [...prev, undoMessage]);
    } catch (err) {
      setError(err instanceof ShownError || err instanceof ItineraryWriteBlockedError ? err.message : t("errors.undoFailed"));
    }
  }, [currentUndo, tripId, clearUndo, onRefetchTrip, run, failure, t]);

  const clearConversation = async () => {
    setMessages([]);
    setConversationId(null);
    setUsageInfo(null);
    setPendingChange(null);
    clearUndo();
  };

  return {
    messages,
    input,
    setInput,
    isLoading,
    error,
    setError,
    usageInfo,
    loadingStage,
    pendingChange,
    isApplyingChange,
    currentUndo,
    clearUndo,
    sendMessage,
    handleApplyChange,
    handleTryDifferent,
    handleCancelChange,
    handleUndo,
    clearConversation,
  };
}
