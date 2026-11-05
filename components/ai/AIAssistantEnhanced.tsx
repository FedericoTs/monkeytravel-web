"use client";

import { useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import type { ItineraryDay } from "@/types";
import { useTripAssistant, type Message } from "@/hooks/useTripAssistant";
import AssistantCards from "./AssistantCards";
import StagedLoadingIndicator from "./StagedLoadingIndicator";
import PreviewChangeCard from "./PreviewChangeCard";
import UndoToast from "./UndoToast";

interface AIAssistantEnhancedProps {
  tripId: string;
  tripTitle: string;
  itinerary: ItineraryDay[];
  isOpen: boolean;
  onClose: () => void;
  onRefetchTrip?: () => Promise<void>;
  /**
   * The trip page's itinerary save queue. Apply and undo run inside it so the
   * page's pending edits are saved first and it can adopt the new version.
   * Without it (other hosts), tasks just run.
   */
  runItineraryWrite?: <T>(task: () => Promise<T>) => Promise<T>;
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
// People can't always tell where an edit landed ("I don't see the updates on
// the webpage"), and model prose can disagree with what was done (a reply
// narrating "a new Day 12" for an activity added to day 1). The badge is
// therefore generated ONLY
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

/**
 * Whether a reply's "Not saved yet" note still holds: it is the latest reply
 * and its change still waits for the button. Applied, cancelled, or followed
 * by another reply, the note would be wrong.
 */
export function showsPendingNote(
  messages: Pick<Message, "role" | "pendingNote" | "action">[],
  index: number,
  changeWaiting: boolean
): boolean {
  const message = messages[index];
  if (!message?.pendingNote || message.action?.applied || !changeWaiting) return false;
  return messages.map((m) => m.role).lastIndexOf("assistant") === index;
}

export default function AIAssistantEnhanced({
  tripId,
  tripTitle,
  itinerary,
  isOpen,
  onClose,
  onRefetchTrip,
  onFocusDay,
  runItineraryWrite,
}: AIAssistantEnhancedProps) {
  const t = useTranslations("common.ai.assistant");
  const tCommon = useTranslations("common");
  // Build quick actions from translations
  const QUICK_ACTIONS = QUICK_ACTION_IDS.map((action) => ({
    id: action.id,
    label: t(`quickActions.${action.id}.label`),
    prompt: t(`quickActions.${action.id}.prompt`),
    icon: action.icon,
  }));

  const {
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
  } = useTripAssistant({ tripId, itinerary, isOpen, onRefetchTrip, onFocusDay, runItineraryWrite });

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
          lg:left-auto lg:bottom-auto lg:right-0 lg:top-0 lg:h-full lg:w-[420px] lg:border-l lg:border-slate-200
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
                aria-label={tCommon("buttons.close")}
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
                <svg className="w-10 h-10 text-[var(--primary-ink)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                    {/* Text content, and while its change waits, what the button does */}
                    {(message.content || showsPendingNote(messages, index, pendingChange !== null)) && (
                      <div
                        className={
                          message.role === "assistant"
                            ? "bg-white rounded-2xl rounded-bl-md px-4 py-3 shadow-sm border border-slate-100"
                            : ""
                        }
                      >
                        {message.content && (
                          <p className="text-sm leading-relaxed whitespace-pre-wrap">
                            {message.content}
                          </p>
                        )}
                        {showsPendingNote(messages, index, pendingChange !== null) && (
                          <p className="text-sm leading-relaxed whitespace-pre-wrap mt-2">
                            {message.pendingNote}
                          </p>
                        )}
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
                        <div className="text-[11px] text-slate-500 px-2.5 w-fit">
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
          <p className="text-[10px] text-slate-500 mt-2 text-center">
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
