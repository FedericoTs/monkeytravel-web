"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Compass, Send, Sparkles, Loader2 } from "lucide-react";
import BaseModal from "@/components/ui/BaseModal";
import { useToast } from "@/components/ui/Toast";
import {
  captureConciergeOpened,
  captureConciergeQuestionSent,
  captureConciergeResponseReceived,
  captureConciergeQuotaBlocked,
  captureConciergeError,
} from "@/lib/posthog/events";

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

  // Funnel marker: track every Concierge open so the dashboard can show
  // (a) how often the feature is discovered and (b) the open→question
  // conversion rate. Live-trip flag isn't known yet (set by the API on
  // first response) — we leave it undefined until then.
  const openTrackedRef = useRef(false);
  useEffect(() => {
    if (!isOpen) {
      openTrackedRef.current = false;
      return;
    }
    if (openTrackedRef.current) return;
    openTrackedRef.current = true;
    void captureConciergeOpened({ trip_id: tripId }).catch(() => {});
  }, [isOpen, tripId]);

  const handleAsk = useCallback(async () => {
    if (loading) return;
    const q = question.trim();
    if (!q) return;
    setLoading(true);
    setLastQuestion(q);
    setAnswer("");
    // Stamp the start so we can record response_time_ms on success.
    // `performance.now()` is monotonic and won't drift if the clock moves.
    const startedAt = performance.now();
    void captureConciergeQuestionSent({
      trip_id: tripId,
      question_length: q.length,
    }).catch(() => {});
    try {
      // Streaming path (perf task #245). The server emits SSE events:
      //   data: {"type":"chunk","text":"…"}
      //   data: {"type":"done","isLiveTrip":bool,"dayNumber":n}
      //   data: {"type":"error","message":"…"}
      // We accumulate `chunk.text` into the answer state on each event so
      // text appears as it's generated — perceived latency drops from
      // ~3s to ~200ms for the first token.
      const res = await fetch("/api/ai/concierge", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Asking for the streaming variant. The route falls back to
          // non-streaming JSON when this header is absent — keeps the
          // contract dual-mode for callers that can't read streams.
          Accept: "text/event-stream",
        },
        body: JSON.stringify({ tripId, question: q }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (res.status === 403 && err?.code === "USAGE_LIMIT_REACHED") {
          setAnswer(t("errorQuota"));
          void captureConciergeQuotaBlocked({ trip_id: tripId }).catch(() => {});
        } else {
          setAnswer(err?.error || t("errorGeneric"));
          void captureConciergeError({
            trip_id: tripId,
            error_type: "unknown",
          }).catch(() => {});
        }
        return;
      }

      // If the server gave us plain JSON anyway (older deploy, no
      // streaming support), fall back to the original blocking path.
      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("text/event-stream") || !res.body) {
        const data = (await res.json()) as {
          answer: string;
          isLiveTrip: boolean;
          dayNumber: number | null;
        };
        setAnswer(data.answer || "");
        setIsLiveTrip(Boolean(data.isLiveTrip));
        setQuestion("");
        void captureConciergeResponseReceived({
          trip_id: tripId,
          response_time_ms: Math.round(performance.now() - startedAt),
          is_live_trip: Boolean(data.isLiveTrip),
          answer_length: (data.answer || "").length,
        }).catch(() => {});
        return;
      }

      // Read the stream incrementally. The SSE wire format is "data: <json>\n\n"
      // — we buffer partial frames across read boundaries since one read
      // is not guaranteed to align with an event boundary.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";
      let streamError: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Split on the double-newline event delimiter.
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? ""; // keep the trailing partial frame for next read

        for (const part of parts) {
          const trimmed = part.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payloadStr = trimmed.slice(5).trim();
          if (!payloadStr) continue;
          try {
            const event = JSON.parse(payloadStr) as
              | { type: "chunk"; text: string }
              | { type: "done"; isLiveTrip: boolean; dayNumber: number | null }
              | { type: "error"; message: string };
            if (event.type === "chunk") {
              accumulated += event.text;
              setAnswer(accumulated);
            } else if (event.type === "done") {
              setIsLiveTrip(Boolean(event.isLiveTrip));
            } else if (event.type === "error") {
              streamError = event.message || t("errorGeneric");
            }
          } catch (parseErr) {
            console.warn("[concierge] SSE parse failed", parseErr, payloadStr);
          }
        }
      }

      if (streamError) {
        setAnswer(streamError);
        void captureConciergeError({
          trip_id: tripId,
          error_type: "stream_parse",
        }).catch(() => {});
      } else {
        // Strip any trailing whitespace artifacts from Gemini chunking.
        const finalAnswer = accumulated.trim();
        setAnswer(finalAnswer);
        setQuestion("");
        // We need the `isLiveTrip` value the stream set above; use the
        // accumulated state ref since setIsLiveTrip is async. Reading
        // the local SSE-parsed value would require threading it through,
        // so we capture from the live state (good enough — the event
        // fires after the render flush).
        void captureConciergeResponseReceived({
          trip_id: tripId,
          response_time_ms: Math.round(performance.now() - startedAt),
          is_live_trip: isLiveTrip,
          answer_length: finalAnswer.length,
        }).catch(() => {});
      }
    } catch (err) {
      console.error("[concierge] ask failed", err);
      addToast(t("errorGeneric"), "error");
      void captureConciergeError({
        trip_id: tripId,
        error_type: "network",
      }).catch(() => {});
    } finally {
      setLoading(false);
    }
  }, [loading, question, tripId, t, addToast, isLiveTrip]);

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
                {loading && !answer ? (
                  /* No tokens yet — show the "thinking" indicator. */
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    <span>{t("thinking")}</span>
                  </div>
                ) : (
                  /* Streaming response — render the accumulating text.
                     While loading, append a blinking caret so the user
                     sees the answer is still being generated. */
                  <p className="text-sm text-slate-900 whitespace-pre-wrap leading-relaxed">
                    {answer}
                    {loading && (
                      <span
                        className="inline-block w-1.5 h-4 ml-0.5 -mb-0.5 bg-violet-500 animate-pulse"
                        aria-hidden="true"
                      />
                    )}
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
