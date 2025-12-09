"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { ItineraryDay, AssistantCard, Activity } from "@/types";
import AssistantCards from "./AssistantCards";
import StagedLoadingIndicator, { type LoadingStage } from "./StagedLoadingIndicator";
import TypingIndicator from "./TypingIndicator";
import PreviewChangeCard from "./PreviewChangeCard";
import MatchConfirmationDialog, { type MatchOption } from "./MatchConfirmationDialog";
import UndoToast, { useUndoState, type UndoState } from "./UndoToast";
import { trackAIAssistantMessage } from "@/lib/analytics";

interface Message {
  role: "user" | "assistant";
  content: string;
  cards?: AssistantCard[];
  action?: {
    type: string;
    applied: boolean;
    activityId?: string;
    dayNumber?: number;
  };
  timestamp: string;
}

// Pending change for confirm-first flow
interface PendingChange {
  type: "replace" | "add" | "remove";
  oldActivity?: Activity;
  newActivity: Activity;
  dayNumber: number;
  reason?: string;
}

interface AIAssistantEnhancedProps {
  tripId: string;
  tripTitle: string;
  itinerary: ItineraryDay[];
  isOpen: boolean;
  onClose: () => void;
  onAction?: (action: string, data?: Record<string, unknown>) => void;
  onItineraryUpdate?: (newItinerary: ItineraryDay[]) => void;
  onRefetchTrip?: () => Promise<void>;
}

// Quick action suggestions
const QUICK_ACTIONS = [
  { label: "Optimize budget", prompt: "Suggest ways to optimize my budget", icon: "💰" },
  { label: "Add restaurant", prompt: "Suggest a great local restaurant to add", icon: "🍽️" },
  { label: "Local tips", prompt: "What are insider tips for this destination?", icon: "💡" },
  { label: "Alternatives", prompt: "Suggest alternative activities I could do", icon: "🔄" },
];

export default function AIAssistantEnhanced({
  tripId,
  tripTitle,
  itinerary,
  isOpen,
  onClose,
  onAction,
  onItineraryUpdate,
  onRefetchTrip,
}: AIAssistantEnhancedProps) {
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

        // Track AI assistant usage
        trackAIAssistantMessage({
          tripId,
          messageLength: content.trim().length,
        });

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
          setMessages((prev) => [...prev, data.message]);

          // If action was applied, set up undo state
          if (data.message?.action?.applied && data.previousItinerary) {
            pushUndo({
              previousItinerary: data.previousItinerary,
              action: {
                type: data.message.action.type.replace("_activity", ""),
                description: data.message.content,
                activityName: data.message.action.activityName,
                dayNumber: data.message.action.dayNumber,
              },
            });

            // Refetch trip data
            if (onRefetchTrip) {
              await onRefetchTrip();
            }
          }
        }

        setUsageInfo({
          remainingRequests: data.usage?.remainingRequests || 0,
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
    [tripId, conversationId, isLoading, onAction, onRefetchTrip, itinerary, simulateLoadingStages, clearUndo, pushUndo]
  );

  // Apply pending change
  const handleApplyChange = useCallback(async () => {
    if (!pendingChange || isApplyingChange) return;

    setIsApplyingChange(true);

    try {
      // Save current state for undo
      const previousItinerary = JSON.parse(JSON.stringify(itinerary));

      const res = await fetch("/api/ai/assistant/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tripId,
          changeType: pendingChange.type,
          oldActivity: pendingChange.oldActivity,
          newActivity: pendingChange.newActivity,
          dayNumber: pendingChange.dayNumber,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to apply change");
      }

      // Update the last message to show "applied"
      setMessages((prev) =>
        prev.map((msg, idx) =>
          idx === prev.length - 1 && msg.role === "assistant"
            ? { ...msg, action: { ...msg.action, applied: true } as Message["action"] }
            : msg
        )
      );

      // Set up undo
      pushUndo({
        previousItinerary,
        action: {
          type: pendingChange.type,
          description: `${pendingChange.type === "replace" ? "Replaced" : "Added"} ${pendingChange.newActivity.name}`,
          activityName: pendingChange.newActivity.name,
          dayNumber: pendingChange.dayNumber,
        },
      });

      // Clear pending and refetch
      setPendingChange(null);
      if (onRefetchTrip) {
        await onRefetchTrip();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply change");
    } finally {
      setIsApplyingChange(false);
    }
  }, [pendingChange, isApplyingChange, tripId, itinerary, pushUndo, onRefetchTrip]);

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
      content: "No problem! Let me know if you'd like to try something else.",
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, cancelMessage]);
  }, []);

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
        content: "Change undone successfully!",
        cards: [
          {
            type: "confirmation",
            icon: "check",
            title: "Change Undone",
            description: `Reverted: ${currentUndo.action.description}`,
          },
        ],
        timestamp: new Date().toISOString(),
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
                <h3 className="font-semibold text-white text-lg">Trip Assistant</h3>
                <p className="text-xs text-white/70 truncate max-w-[200px]">{tripTitle}</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {usageInfo && (
                <span className="text-[11px] text-white/60 px-2 py-1 rounded-full bg-white/10 hidden sm:inline">
                  {usageInfo.remainingRequests} left
                </span>
              )}
              <button
                onClick={clearConversation}
                className="p-2.5 text-white/70 hover:text-white hover:bg-white/10 rounded-xl transition-all"
                title="Clear conversation"
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
              <h4 className="font-semibold text-slate-900 mb-1">How can I help?</h4>
              <p className="text-sm text-slate-500 mb-6 max-w-[280px] mx-auto">
                Ask me to add activities, replace places, or get local tips
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

                    {/* Action indicator */}
                    {message.action?.applied && (
                      <div className="flex items-center gap-1.5 text-[11px] text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full w-fit">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        Change applied
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {/* Pending Change Preview (Confirm-First Flow) */}
              {pendingChange && (
                <div className="flex justify-start">
                  <div className="max-w-[88%]">
                    <PreviewChangeCard
                      oldActivity={pendingChange.oldActivity!}
                      newActivity={pendingChange.newActivity}
                      dayNumber={pendingChange.dayNumber}
                      reason={pendingChange.reason}
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
        <form onSubmit={handleSubmit} className="p-4 border-t border-slate-200 bg-white">
          <div className="flex items-end gap-2">
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Replace the Colosseum with something quieter..."
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
            Try: &quot;Replace X with Y&quot; or &quot;Add a cafe near the museum&quot;
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
