"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { ItineraryDay, AssistantCard } from "@/types";
import AssistantCards from "./AssistantCards";
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

interface AIAssistantProps {
  tripId: string;
  tripTitle: string;
  itinerary: ItineraryDay[];
  isOpen: boolean;
  onClose: () => void;
  onAction?: (action: string, data?: Record<string, unknown>) => void;
  onItineraryUpdate?: (newItinerary: ItineraryDay[]) => void;
  onRefetchTrip?: () => Promise<void>; // Refetch trip data after AI modifications
}

// Quick action suggestions - more concise
const QUICK_ACTIONS = [
  { label: "Optimize budget", prompt: "Suggest ways to optimize my budget", icon: "💰" },
  { label: "Add restaurant", prompt: "Suggest a great local restaurant to add", icon: "🍽️" },
  { label: "Local tips", prompt: "What are insider tips for this destination?", icon: "💡" },
  { label: "Alternatives", prompt: "Suggest alternative activities I could do", icon: "🔄" },
];

export default function AIAssistant({
  tripId,
  tripTitle,
  itinerary,
  isOpen,
  onClose,
  onAction,
  onItineraryUpdate,
  onRefetchTrip,
}: AIAssistantProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usageInfo, setUsageInfo] = useState<{
    remainingRequests: number;
    model: string;
  } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || isLoading) return;

      setError(null);
      const userMessage: Message = {
        role: "user",
        content: content.trim(),
        timestamp: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, userMessage]);
      setInput("");
      setIsLoading(true);

      try {
        const res = await fetch("/api/ai/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tripId,
            message: content.trim(),
            conversationId,
            itinerary, // Send current itinerary for context
          }),
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "Failed to get response");
        }

        if (data.conversationId && !conversationId) {
          setConversationId(data.conversationId);
        }

        // Add assistant message with cards
        setMessages((prev) => [...prev, data.message]);
        setUsageInfo({
          remainingRequests: data.usage.remainingRequests,
          model: data.model,
        });

        // Track AI assistant usage for engagement analytics
        trackAIAssistantMessage({
          tripId,
          messageLength: content.trim().length,
        });

        // Debug logging
        console.log("[AIAssistant] Response received:", {
          hasModifiedItinerary: !!data.modifiedItinerary,
          hasOnRefetchTrip: !!onRefetchTrip,
          actionApplied: data.message?.action?.applied,
          debug: data.debug,
        });

        // Handle itinerary updates from autonomous actions
        // ALWAYS refetch from database when an action was applied
        // This is the most reliable method since the database IS updated
        if (data.message?.action?.applied && onRefetchTrip) {
          console.log("[AIAssistant] Action was applied, refetching trip data from database...");
          try {
            await onRefetchTrip();
            console.log("[AIAssistant] Trip data refetched successfully - UI should now be updated");
          } catch (err) {
            console.error("[AIAssistant] Failed to refetch trip:", err);
          }
        }

        // Handle action if present
        if (data.message.action && onAction) {
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
    [tripId, conversationId, isLoading, onAction, onRefetchTrip, itinerary]
  );

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
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop for mobile */}
      <div
        className="fixed inset-0 bg-black/50 z-[60] lg:hidden backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Sidebar / Bottom Sheet - z-[70] ensures it's above MobileBottomNav (z-50) */}
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
        {/* Header - Premium gradient */}
        <div className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-[var(--primary)] via-[var(--primary)] to-[var(--primary-deeper)]" />
          <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxwYXRoIGQ9Ik0zNiAxOGMtNi42MjcgMC0xMiA1LjM3My0xMiAxMnM1LjM3MyAxMiAxMiAxMiAxMi01LjM3MyAxMi0xMi01LjM3My0xMi0xMi0xMnptMCAxOGMtMy4zMTQgMC02LTIuNjg2LTYtNnMyLjY4Ni02IDYtNiA2IDIuNjg2IDYgNi0yLjY4NiA2LTYgNnoiIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iLjA1Ii8+PC9nPjwvc3ZnPg==')] opacity-30" />

          <div className="relative flex items-center justify-between px-4 py-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center shadow-lg">
                <svg
                  className="w-6 h-6 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                  />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-white text-lg">Trip Assistant</h3>
                <p className="text-xs text-white/70 truncate max-w-[200px]">
                  {tripTitle}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {usageInfo && (
                <span className="text-[11px] text-white/60 px-2 py-1 rounded-full bg-white/10 hidden sm:inline">
                  {usageInfo.remainingRequests} requests left
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
                <svg
                  className="w-10 h-10 text-[var(--primary)]"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                  />
                </svg>
              </div>
              <h4 className="font-semibold text-slate-900 mb-1">
                How can I help?
              </h4>
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

              {/* Loading indicator */}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-white rounded-2xl rounded-bl-md px-4 py-4 shadow-sm border border-slate-100">
                    <div className="flex items-center gap-2">
                      <div className="flex gap-1">
                        <div className="w-2 h-2 bg-[var(--primary)] rounded-full animate-bounce" />
                        <div
                          className="w-2 h-2 bg-[var(--primary)] rounded-full animate-bounce"
                          style={{ animationDelay: "0.1s" }}
                        />
                        <div
                          className="w-2 h-2 bg-[var(--primary)] rounded-full animate-bounce"
                          style={{ animationDelay: "0.2s" }}
                        />
                      </div>
                      <span className="text-xs text-slate-400">Thinking...</span>
                    </div>
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
            </p>
          </div>
        )}

        {/* Quick actions strip when there are messages */}
        {messages.length > 0 && !isLoading && (
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
        <form
          onSubmit={handleSubmit}
          className="p-4 border-t border-slate-200 bg-white"
        >
          <div className="flex items-end gap-2">
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Replace the Colosseum with something quieter..."
                rows={1}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 outline-none resize-none text-sm bg-slate-50 focus:bg-white transition-colors"
                style={{ maxHeight: "100px" }}
              />
            </div>
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className="p-3 bg-gradient-to-br from-[var(--primary)] to-[var(--primary-deeper)] text-white rounded-xl hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0 shadow-md"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                />
              </svg>
            </button>
          </div>

          {/* Hint text */}
          <p className="text-[10px] text-slate-400 mt-2 text-center">
            Try: "Replace X with Y" or "Add a cafe near the museum"
          </p>
        </form>
      </div>
    </>
  );
}
