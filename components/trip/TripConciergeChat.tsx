"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Compass, Send, Sparkles, Loader2 } from "lucide-react";
import BaseModal from "@/components/ui/BaseModal";
import { useToast } from "@/components/ui/Toast";

/**
 * F4 In-trip AI Concierge — context-aware Q&A modal (task #242).
 *
 * Differs from the planning AIAssistantEnhanced in three ways the user
 * actually feels:
 *   - Read-only — never modifies the itinerary. Lower stakes, less
 *     confirmation friction, you can ask anything.
 *   - Today-aware — when the trip is live (today falls inside the
 *     window), the API auto-injects today's activities so you can
 *     ask "what's near Castello after lunch?" without restating.
 *   - Single-turn — each ask is independent. No conversation memory
 *     in v1; the UI shows your last question + the answer, then
 *     resets when you ask again. Lower latency, lower cost, simpler.
 *
 * Flag: NEXT_PUBLIC_CONCIERGE_ENABLED. Defaults off so we can ship
 * the code path + DB plumbing now and enable per-environment.
 */
interface TripConciergeChatProps {
  tripId: string;
  className?: string;
}

export default function TripConciergeChat(props: TripConciergeChatProps) {
  if (process.env.NEXT_PUBLIC_CONCIERGE_ENABLED !== "true") {
    return null;
  }
  return <TripConciergeChatInner {...props} />;
}

function TripConciergeChatInner({
  tripId,
  className = "",
}: TripConciergeChatProps) {
  const t = useTranslations("common.concierge");
  const { addToast } = useToast();

  const [isOpen, setIsOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [lastQuestion, setLastQuestion] = useState<string | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [isLiveTrip, setIsLiveTrip] = useState<boolean>(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Autofocus the textarea when the modal opens. The slight delay lets
  // BaseModal's focus trap settle before we steal focus.
  useEffect(() => {
    if (!isOpen) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 80);
    return () => window.clearTimeout(id);
  }, [isOpen]);

  const handleAsk = useCallback(async () => {
    if (loading) return;
    const q = question.trim();
    if (!q) return;
    setLoading(true);
    setLastQuestion(q);
    setAnswer(null);
    try {
      const res = await fetch("/api/ai/concierge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tripId, question: q }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        // 403 with USAGE_LIMIT_REACHED is the most common non-bug
        // failure — surface it inline rather than as a generic toast so
        // the user understands what happened.
        if (res.status === 403 && err?.code === "USAGE_LIMIT_REACHED") {
          setAnswer(t("errorQuota"));
        } else {
          setAnswer(err?.error || t("errorGeneric"));
        }
        return;
      }
      const data = (await res.json()) as {
        answer: string;
        isLiveTrip: boolean;
        dayNumber: number | null;
      };
      setAnswer(data.answer || "");
      setIsLiveTrip(Boolean(data.isLiveTrip));
      setQuestion("");
    } catch (err) {
      console.error("[concierge] ask failed", err);
      addToast(t("errorGeneric"), "error");
    } finally {
      setLoading(false);
    }
  }, [loading, question, tripId, t, addToast]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter to send, Shift+Enter for newline — standard chat convention.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleAsk();
    }
  };

  return (
    <>
      {/* Trigger button — sized as a pill for the action bar. */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white hover:opacity-90 transition-opacity shadow-sm ${className}`}
      >
        <Compass className="w-4 h-4" aria-hidden="true" />
        {t("triggerLabel")}
      </button>

      <BaseModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title={t("modalTitle")}
        maxWidth="max-w-xl"
        usePortal
      >
        <div className="space-y-4">
          {/* Mode banner — surfaces whether the API is in "today" mode
              so the user understands why answers ground in current
              activities when the trip is live. */}
          {answer !== null && isLiveTrip && (
            <div className="flex items-center gap-2 text-xs text-violet-700 bg-violet-50 border border-violet-100 rounded-lg px-3 py-2">
              <Sparkles className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
              <span>{t("liveTripHint")}</span>
            </div>
          )}

          {/* Last question + answer pair. We keep this above the input
              so a re-ask doesn't push the previous response off-screen. */}
          {lastQuestion && (
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-1">
                  {t("yourQuestion")}
                </p>
                <p className="text-sm text-slate-700">{lastQuestion}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-1">
                  {t("answer")}
                </p>
                {loading ? (
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    <span>{t("thinking")}</span>
                  </div>
                ) : (
                  <p className="text-sm text-slate-900 whitespace-pre-wrap leading-relaxed">
                    {answer}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Input */}
          <div>
            <label htmlFor="concierge-question" className="sr-only">
              {t("inputLabel")}
            </label>
            <textarea
              ref={inputRef}
              id="concierge-question"
              value={question}
              onChange={(e) => setQuestion(e.target.value.slice(0, 800))}
              onKeyDown={handleKeyDown}
              placeholder={t("placeholder")}
              rows={3}
              disabled={loading}
              className="w-full rounded-lg border border-slate-200 p-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-violet-500 focus:ring-2 focus:ring-violet-200 focus:outline-none disabled:opacity-60 disabled:bg-slate-50 resize-none"
            />
            <div className="mt-1 flex items-center justify-between gap-2">
              <p className="text-xs text-slate-500">
                {t("hint")}
              </p>
              <button
                type="button"
                onClick={handleAsk}
                disabled={loading || !question.trim()}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-violet-600 text-white hover:bg-violet-700 transition-colors disabled:opacity-50"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Send className="w-4 h-4" aria-hidden="true" />
                )}
                {loading ? t("sending") : t("send")}
              </button>
            </div>
          </div>
        </div>
      </BaseModal>
    </>
  );
}
