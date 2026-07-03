"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import type { ItineraryDay, AssistantCard, Activity } from "@/types";
import AssistantCards from "./AssistantCards";
import StagedLoadingIndicator, { type LoadingStage } from "./StagedLoadingIndicator";
import PreviewChangeCard, { type PendingChange } from "./PreviewChangeCard";
import MatchConfirmationDialog, { type MatchOption } from "./MatchConfirmationDialog";
import UndoToast, { useUndoState, type UndoState } from "./UndoToast";
import { trackAIAssistantMessage } from "@/lib/analytics";
import { captureAIAssistantUsed } from "@/lib/posthog/events";

interface Message {
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
}

// PendingChange (the confirm-first proposed-change union) is defined in and
// imported from ./PreviewChangeCard — it mirrors the server's `pendingChange`
// discriminated union (replace | add | adjust_duration | reorder).

interface AIAssistantEnhancedProps {
  tripId: string;
  tripTitle: string;
  itinerary: ItineraryDay[];
  isOpen: boolean;
  onClose: () => void;
  onAction?: (action: string, data?: Record<string, unknown>) => void;
  onItineraryUpdate?: (newItinerary: ItineraryDay[]) => void;
  onRefetchTrip?: () => Promise<void>;
  // APPLY → SEE loop: scroll + flash the affected day card in the itinerary
  // (transcripts: "I don't see the updates on the webpage"). Called after an
  // applied action refetches, and when the user taps the action badge.
  onFocusDay?: (dayNumber: number) => void;
}

// Quick action IDs - labels come from translations
const QUICK_ACTION_IDS = [
  { id: "optimizeBudget", icon: "💰" },
  { id: "addRestaurant", icon: "🍽️" },
  { id: "localTips", icon: "💡" },
  { id: "alternatives", icon: "🔄" },
];

// ---------------------------------------------------------------------------
// Deterministic action badge (trust loop).
//
// Transcript evidence (persisted ai_conversations, 2026-07): 3 of 17 recent
// conversations contain "I don't see the updates on the webpage" / "I don't
// see it on the right" / "where to see the updated version?" — and one reply
// narrated "extended with a new Day 12" while its logged action was
// {type: add_activity, dayNumber: 1}. The badge is therefore generated ONLY
// from the action metadata, never from model prose: when narration and
// metadata disagree, the badge sides with the metadata.
// ---------------------------------------------------------------------------

/** Map action types onto badge variants. Handles BOTH server unions: the
 *  POST route's `*_activity` types and the /apply route's short types.
 *  add_day / apply_draft are the structural actions (same type string on
 *  both routes). */
function actionBadgeVariant(
  type: string | undefined
): "replaced" | "added" | "removed" | "rescheduled" | "durationAdjusted" | "dayAdded" | "daysUpdated" | null {
  switch (type) {
    case "replace":
    case "replace_activity":
      return "replaced";
    case "add":
    case "add_activity":
      return "added";
    case "remove":
    case "remove_activity":
      return "removed";
    case "reorder":
      return "rescheduled";
    case "adjust_duration":
      return "durationAdjusted";
    case "add_day":
      return "dayAdded";
    case "apply_draft":
      return "daysUpdated";
    default:
      return null;
  }
}

/** Activity name for the badge — metadata only: the action itself (threaded
 *  from the /apply response) or the server-built card whose type matches the
 *  action (cards are persisted with the message, so history gets names too). */
function actionActivityName(message: Message): string | undefined {
  if (message.action?.activityName) return message.action.activityName;
  const variant = actionBadgeVariant(message.action?.type);
  for (const card of message.cards || []) {
    if (variant === "replaced" && card.type === "activity_replacement") {
      return card.newActivity.name;
    }
    if (variant === "added" && card.type === "activity_added") {
      return card.activity.name;
    }
    if (variant === "durationAdjusted" && card.type === "duration_adjusted") {
      return card.activity.name;
    }
  }
  return undefined;
}

export default function AIAssistantEnhanced({
  tripId,
  tripTitle,
  itinerary,
  isOpen,
  onClose,
  onAction,
  onItineraryUpdate,
  onRefetchTrip,
  onFocusDay,
}: AIAssistantEnhancedProps) {
  const t = useTranslations("common.ai.assistant");

  // Build quick actions from translations
  const QUICK_ACTIONS = QUICK_ACTION_IDS.map((action) => ({
    id: action.id,
    label: t(`quickActions.${action.id}.label`),
    prompt: t(`quickActions.${action.id}.prompt`),
    icon: action.icon,
  }));

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
  const [pendingChange, setPendingChange] = useState<PendingChange | null>(null);
  const [matchConfirmation, setMatchConfirmation] = useState<{
    query: string;
    matches: MatchOption[];
  } | null>(null);
  const [isApplyingChange, setIsApplyingChange] = useState(false);

  // Undo state management
  const { currentUndo, pushUndo, clearUndo } = useUndoState();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pendingChange]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Load existing conversation
  useEffect(() => {
    if (isOpen && tripId && !conversationId) {
      loadConversation();
    }
  }, [isOpen, tripId]);

  const loadConversation = async () => {
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
  };

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

  const sendMessage = useCallback(
    async (content: string, previewMode: boolean = true) => {
      if (!content.trim() || isLoading) return;

      // Clear any pending changes when user sends new message
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
            previewMode, // Request preview mode (confirm-first)
          }),
        });

        stopStages();
        setLoadingStage("complete");

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "Failed to get response");
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
        // a chat answer or an auto-applied edit (no pending change). When the
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

        // Check if there's a pending change that needs confirmation
        if (data.pendingChange && previewMode) {
          setPendingChange(data.pendingChange);
          // Add assistant message without the "applied" indicator
          const assistantMsg = {
            ...data.message,
            action: { ...data.message.action, applied: false },
          };
          setMessages((prev) => [...prev, assistantMsg]);
        }
        // Check if there are ambiguous matches that need confirmation
        else if (data.matchConfirmation) {
          setMatchConfirmation(data.matchConfirmation);
          setMessages((prev) => [...prev, data.message]);
        }
        // Normal flow - action was applied or no action needed
        else {
          // TRUST GUARD: only believe `action.applied` when the server proves
          // it — `modifiedItinerary` is present iff the trips row was actually
          // written (the route drops it on DB failure, and a model-fabricated
          // `action` in the JSON reply never has it). Otherwise downgrade to
          // not-applied so the honest "no changes" badge renders instead of a
          // green confirmation for an edit that never landed. (transcripts:
          // "I don't see the updates on the webpage")
          const verifiedApplied =
            !!data.message?.action?.applied && !!data.modifiedItinerary;
          const assistantMsg: Message =
            data.message?.action?.applied && !verifiedApplied
              ? { ...data.message, action: { ...data.message.action, applied: false } }
              : data.message;
          setMessages((prev) => [...prev, assistantMsg]);

          // If action was applied, set up undo state
          if (verifiedApplied && data.previousItinerary) {
            pushUndo({
              previousItinerary: data.previousItinerary,
              action: {
                type: data.message.action.type.replace("_activity", ""),
                description: data.message.content,
                activityName: data.message.action.activityName,
                dayNumber: data.message.action.dayNumber,
              },
            });
          }

          if (verifiedApplied) {
            // Refetch trip data so the itinerary UI re-renders the change
            if (onRefetchTrip) {
              await onRefetchTrip();
            }
            // APPLY → SEE: anchor the user on the day that changed.
            if (typeof data.message.action?.dayNumber === "number") {
              onFocusDay?.(data.message.action.dayNumber);
            }
          }
        }

        setUsageInfo({
          // The route emits `usage.remaining` (not `remainingRequests`); the
          // old key left the header request-count pill permanently blank.
          remainingRequests: data.usage?.remaining ?? 0,
          model: data.model || "unknown",
        });

        // Handle action callback
        if (data.message?.action && onAction) {
          onAction(data.message.action.type, {
            ...data.message.action,
            modifiedItinerary: data.modifiedItinerary,
          });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
        setMessages((prev) => prev.slice(0, -1));
      } finally {
        setIsLoading(false);
      }
    },
    [tripId, conversationId, isLoading, onAction, onRefetchTrip, onFocusDay, itinerary, simulateLoadingStages, clearUndo, pushUndo]
  );

  // Apply pending change
  const handleApplyChange = useCallback(async () => {
    if (!pendingChange || isApplyingChange) return;

    setIsApplyingChange(true);

    try {
      // Save current state for undo
      const previousItinerary = JSON.parse(JSON.stringify(itinerary));

      // The /apply route validates DIFFERENT fields per change type. Sending
      // {oldActivity,newActivity} for adjust_duration/reorder returns 400
      // ("Missing activity/newDuration" / "Missing activities"). Build the
      // exact payload the route expects for each discriminant.
      //
      // apply_draft spans several days and has no single dayNumber — the
      // route (and the focus/badge below) key on the FIRST changed day.
      const appliedDayNumber =
        pendingChange.type === "apply_draft"
          ? pendingChange.changedDayNumbers[0] ?? 1
          : pendingChange.dayNumber;
      const applyBody: Record<string, unknown> = {
        tripId,
        changeType: pendingChange.type,
        dayNumber: appliedDayNumber,
      };
      if (pendingChange.type === "replace") {
        applyBody.oldActivity = pendingChange.oldActivity;
        applyBody.newActivity = pendingChange.newActivity;
      } else if (pendingChange.type === "add") {
        applyBody.newActivity = pendingChange.newActivity;
      } else if (pendingChange.type === "adjust_duration") {
        applyBody.activity = pendingChange.activity;
        applyBody.oldDuration = pendingChange.oldDuration;
        applyBody.newDuration = pendingChange.newDuration;
      } else if (pendingChange.type === "reorder") {
        applyBody.activities = pendingChange.activities;
      } else if (pendingChange.type === "add_day") {
        applyBody.day = pendingChange.day;
      } else if (pendingChange.type === "apply_draft") {
        applyBody.days = pendingChange.days;
      }

      const res = await fetch("/api/ai/assistant/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(applyBody),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to apply change");
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

      // Human label for the undo toast. newActivity is undefined for
      // adjust_duration/reorder, so derive the name/description per type
      // instead of reading pendingChange.newActivity.name blindly (crash).
      const changedName =
        pendingChange.type === "replace" || pendingChange.type === "add"
          ? pendingChange.newActivity.name
          : pendingChange.type === "adjust_duration"
            ? pendingChange.activity.name
            : pendingChange.type === "add_day"
              ? pendingChange.day.theme
              : undefined;
      const undoDescription =
        pendingChange.type === "replace"
          ? `Replaced with ${changedName}`
          : pendingChange.type === "add"
            ? `Added ${changedName}`
            : pendingChange.type === "adjust_duration"
              ? `Adjusted ${changedName}`
              : pendingChange.type === "add_day"
                ? `Added Day ${confirmedDayNumber}`
                : pendingChange.type === "apply_draft"
                  ? `Updated ${pendingChange.days.length} days`
                  : `Reordered Day ${pendingChange.dayNumber}`;

      // Set up undo
      pushUndo({
        previousItinerary,
        // add_day also extended trips.end_date — the undo must restore it
        // together with the itinerary (see /api/ai/assistant/undo).
        previousEndDate:
          pendingChange.type === "add_day"
            ? pendingChange.previousEndDate
            : undefined,
        action: {
          type: pendingChange.type,
          description: undoDescription,
          activityName: changedName,
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply change");
    } finally {
      setIsApplyingChange(false);
    }
  }, [pendingChange, isApplyingChange, tripId, itinerary, pushUndo, onRefetchTrip, onFocusDay]);

  // Try different suggestion
  const handleTryDifferent = useCallback(() => {
    setPendingChange(null);
    // Re-send the last user message with a "try different" modifier
    const lastUserMessage = messages.filter((m) => m.role === "user").pop();
    if (lastUserMessage) {
      sendMessage(`Try a different option for: ${lastUserMessage.content}`, true);
    }
  }, [messages, sendMessage]);

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

  // Handle match selection
  const handleMatchSelect = useCallback(
    async (activity: Activity, dayNumber: number) => {
      setMatchConfirmation(null);
      // Re-send with specific activity context
      const lastUserMessage = messages.filter((m) => m.role === "user").pop();
      if (lastUserMessage) {
        sendMessage(
          `${lastUserMessage.content} (I mean the "${activity.name}" on Day ${dayNumber})`,
          true
        );
      }
    },
    [messages, sendMessage]
  );

  // Handle undo
  const handleUndo = useCallback(async () => {
    if (!currentUndo) return;

    try {
      const res = await fetch("/api/ai/assistant/undo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tripId,
          previousItinerary: currentUndo.previousItinerary,
          // add_day undos also roll trips.end_date back (see /undo route)
          previousEndDate: currentUndo.previousEndDate,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to undo");
      }

      // Clear undo and refetch
      clearUndo();
      if (onRefetchTrip) {
        await onRefetchTrip();
      }

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
      setError("Failed to undo change");
    }
  }, [currentUndo, tripId, clearUndo, onRefetchTrip]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const handleQuickAction = (prompt: string) => {
    sendMessage(prompt);
  };

  const clearConversation = async () => {
    setMessages([]);
    setConversationId(null);
    setUsageInfo(null);
    setPendingChange(null);
    setMatchConfirmation(null);
    clearUndo();
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop for mobile */}
      <div
        className="fixed inset-0 bg-black/50 z-[60] lg:hidden backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Sidebar / Bottom Sheet */}
      <div
        className={`
          fixed z-[70] bg-white shadow-2xl
          lg:right-0 lg:top-0 lg:h-full lg:w-[420px] lg:border-l lg:border-slate-200
          bottom-0 left-0 right-0 h-[85vh] rounded-t-3xl lg:rounded-none
          flex flex-col overflow-hidden
          transform transition-transform duration-300 ease-out
          ${isOpen ? "translate-y-0 lg:translate-x-0" : "translate-y-full lg:translate-x-full"}
        `}
      >
        {/* Header */}
        <div className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-[var(--primary)] via-[var(--primary)] to-[var(--primary-deeper)]" />
          <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxwYXRoIGQ9Ik0zNiAxOGMtNi42MjcgMC0xMiA1LjM3My0xMiAxMnM1LjM3MyAxMiAxMiAxMiAxMi01LjM3MyAxMi0xMi01LjM3My0xMi0xMi0xMnptMCAxOGMtMy4zMTQgMC02LTIuNjg2LTYtNnMyLjY4Ni02IDYtNiA2IDIuNjg2IDYgNi0yLjY4NiA2LTYgNnoiIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iLjA1Ii8+PC9nPjwvc3ZnPg==')] opacity-30" />

          <div className="relative flex items-center justify-between px-4 py-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center shadow-lg">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-white text-lg">{t("title")}</h3>
                <p className="text-xs text-white/70 truncate max-w-[200px]">{tripTitle}</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {usageInfo && (
                <span className="text-[11px] text-white/60 px-2 py-1 rounded-full bg-white/10 hidden sm:inline">
                  {t("requestsLeft", { count: usageInfo.remainingRequests })}
                </span>
              )}
              <button
                onClick={clearConversation}
                className="p-2.5 text-white/70 hover:text-white hover:bg-white/10 rounded-xl transition-all"
                title={t("clearConversation")}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
              <button
                onClick={onClose}
                className="p-2.5 text-white/70 hover:text-white hover:bg-white/10 rounded-xl transition-all"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gradient-to-b from-slate-50 to-white">
          {messages.length === 0 ? (
            <div className="text-center py-8">
              <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-[var(--primary)]/10 to-[var(--primary)]/5 flex items-center justify-center">
                <svg className="w-10 h-10 text-[var(--primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <h4 className="font-semibold text-slate-900 mb-1">{t("welcomeTitle")}</h4>
              <p className="text-sm text-slate-500 mb-6 max-w-[280px] mx-auto">
                {t("welcomeSubtitle")}
              </p>

              {/* Quick Actions Grid */}
              <div className="grid grid-cols-2 gap-2 max-w-[320px] mx-auto">
                {QUICK_ACTIONS.map((action) => (
                  <button
                    key={action.label}
                    onClick={() => handleQuickAction(action.prompt)}
                    className="flex items-center gap-2 px-3 py-2.5 text-sm font-medium bg-white text-slate-700 rounded-xl border border-slate-200 hover:border-[var(--primary)] hover:bg-[var(--primary)]/5 transition-all shadow-sm hover:shadow"
                  >
                    <span className="text-lg">{action.icon}</span>
                    <span className="text-left text-[13px]">{action.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map((message, index) => (
                <div
                  key={index}
                  className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[88%] ${
                      message.role === "user"
                        ? "bg-gradient-to-br from-[var(--primary)] to-[var(--primary-deeper)] text-white rounded-2xl rounded-br-md px-4 py-3 shadow-md"
                        : "space-y-3"
                    }`}
                  >
                    {/* Text content */}
                    {message.content && (
                      <div
                        className={
                          message.role === "assistant"
                            ? "bg-white rounded-2xl rounded-bl-md px-4 py-3 shadow-sm border border-slate-100"
                            : ""
                        }
                      >
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">
                          {message.content}
                        </p>
                      </div>
                    )}

                    {/* Cards for assistant messages */}
                    {message.role === "assistant" && message.cards && message.cards.length > 0 && (
                      <AssistantCards cards={message.cards} />
                    )}

                    {/* Deterministic action badge — generated from the LOGGED
                        action metadata, never from model prose (transcripts:
                        one reply narrated "extended with a new Day 12" while
                        the logged action was {type: add_activity, dayNumber:
                        1} — the badge sides with the metadata). Applied →
                        clickable "Day N updated" chip that re-anchors the day
                        card; no applied action → quiet "no changes" line so
                        silent no-ops become visible (the honesty signal). */}
                    {message.role === "assistant" && !message.local && (() => {
                      if (message.action?.applied) {
                        const variant = actionBadgeVariant(message.action.type);
                        const day =
                          typeof message.action.dayNumber === "number"
                            ? message.action.dayNumber
                            : undefined;
                        // No single activity name for a reorder or a bulk
                        // draft revision — the /apply route fills placeholder
                        // names there ("Schedule"); skip them. dayAdded keeps
                        // the name (the /apply action carries the day theme).
                        const name =
                          variant === "rescheduled" || variant === "daysUpdated"
                            ? undefined
                            : actionActivityName(message);
                        // daysUpdated is count-based ("{count} days updated");
                        // its dayNumber (first affected day) still powers the
                        // click-to-focus below.
                        const label =
                          variant === "daysUpdated"
                            ? typeof message.action.dayCount === "number"
                              ? t("actionBadge.daysUpdated", { count: message.action.dayCount })
                              : t("actionBadge.updatedGeneric")
                            : day !== undefined && variant
                              ? t(`actionBadge.${variant}`, { day })
                              : t("actionBadge.updatedGeneric");
                        return (
                          <button
                            type="button"
                            onClick={
                              day !== undefined ? () => onFocusDay?.(day) : undefined
                            }
                            disabled={day === undefined}
                            title={
                              day !== undefined
                                ? t("actionBadge.viewDay", { day })
                                : undefined
                            }
                            className={`flex items-center gap-1.5 text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full w-fit max-w-full text-left ${
                              day !== undefined
                                ? "hover:bg-emerald-100 transition-colors cursor-pointer"
                                : ""
                            }`}
                          >
                            <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            <span className="truncate">
                              {label}
                              {name ? ` · ${name}` : ""}
                            </span>
                            {day !== undefined && (
                              <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                            )}
                          </button>
                        );
                      }
                      return (
                        <div className="text-[11px] text-slate-400 px-2.5 w-fit">
                          {t("actionBadge.noChanges")}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              ))}

              {/* Pending Change Preview (Confirm-First Flow) */}
              {pendingChange && (
                <div className="flex justify-start">
                  <div className="max-w-[88%]">
                    <PreviewChangeCard
                      change={pendingChange}
                      onApply={handleApplyChange}
                      onTryDifferent={handleTryDifferent}
                      onCancel={handleCancelChange}
                      isApplying={isApplyingChange}
                    />
                  </div>
                </div>
              )}

              {/* Match Confirmation Dialog */}
              {matchConfirmation && (
                <div className="flex justify-start">
                  <div className="max-w-[88%]">
                    <MatchConfirmationDialog
                      query={matchConfirmation.query}
                      matches={matchConfirmation.matches}
                      onSelect={handleMatchSelect}
                      onCancel={() => setMatchConfirmation(null)}
                    />
                  </div>
                </div>
              )}

              {/* Enhanced Loading indicator with stages */}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="max-w-[88%]">
                    <StagedLoadingIndicator currentStage={loadingStage} />
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* Error message */}
        {error && (
          <div className="px-4 py-2 bg-red-50 border-t border-red-100">
            <p className="text-sm text-red-600 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {error}
              <button
                onClick={() => setError(null)}
                className="ml-auto text-red-400 hover:text-red-600"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </p>
          </div>
        )}

        {/* Quick actions strip */}
        {messages.length > 0 && !isLoading && !pendingChange && (
          <div className="px-4 py-2 border-t border-slate-100 bg-white">
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
              {QUICK_ACTIONS.slice(0, 3).map((action) => (
                <button
                  key={action.label}
                  onClick={() => handleQuickAction(action.prompt)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-100 text-slate-600 rounded-full hover:bg-slate-200 transition-colors whitespace-nowrap flex-shrink-0"
                >
                  <span>{action.icon}</span>
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Input */}
        <form onSubmit={handleSubmit} className="p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] border-t border-slate-200 bg-white">
          <div className="flex items-end gap-2">
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t("placeholder")}
                rows={1}
                disabled={isLoading || isApplyingChange}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 outline-none resize-none text-sm bg-slate-50 focus:bg-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ maxHeight: "100px" }}
              />
            </div>
            <button
              type="submit"
              disabled={!input.trim() || isLoading || isApplyingChange}
              className="p-3 bg-gradient-to-br from-[var(--primary)] to-[var(--primary-deeper)] text-white rounded-xl hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0 shadow-md"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>

          {/* Hint text */}
          <p className="text-[10px] text-slate-400 mt-2 text-center">
            {t("hint")}
          </p>
        </form>
      </div>

      {/* Undo Toast */}
      <UndoToast
        undoState={currentUndo}
        onUndo={handleUndo}
        onDismiss={clearUndo}
        persistUntilNextAction
      />
    </>
  );
}
