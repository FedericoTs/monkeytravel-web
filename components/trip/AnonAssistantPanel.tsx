"use client";

/**
 * Read-only AI Q&A panel for the ANONYMOUS generation-result view (pre-save).
 *
 * Discoverability audit 2026-07-01 (Tier 3-B1): the AI Assistant / Concierge
 * only existed on the saved trip-detail page — anonymous users landing on their
 * just-generated itinerary (peak intent) had no way to ask questions about it.
 * This talks to POST /api/ai/concierge-anon (unauthenticated, rate-limited,
 * read-only), passing the in-memory itinerary as context. It cannot edit the
 * trip — that's the editing assistant (a separate, larger follow-up).
 */

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import type { ItineraryDay } from "@/types";

interface AnonAssistantPanelProps {
  destination: string;
  tripTitle: string;
  days: ItineraryDay[];
  startDate?: string;
  endDate?: string;
}

interface Msg {
  role: "user" | "assistant";
  text: string;
}

export default function AnonAssistantPanel({
  destination,
  tripTitle,
  days,
  startDate,
  endDate,
}: AnonAssistantPanelProps) {
  const t = useTranslations("trips");
  const locale = useLocale();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || loading) return;
    setError(null);
    setInput("");
    setMessages((m) => [...m, { role: "user", text: q }]);
    setLoading(true);
    try {
      const res = await fetch("/api/ai/concierge-anon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: q,
          destination,
          tripTitle,
          days,
          startDate,
          endDate,
          locale,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error?.message || data?.message || t("assistant.errorMsg"));
        return;
      }
      const answer: string = data?.data?.answer ?? data?.answer ?? "";
      if (answer) {
        setMessages((m) => [...m, { role: "assistant", text: answer }]);
      } else {
        setError(t("assistant.errorMsg"));
      }
    } catch {
      setError(t("assistant.errorMsg"));
    } finally {
      setLoading(false);
    }
  };

  const suggestions = [
    t("assistant.suggest1"),
    t("assistant.suggest2"),
    t("assistant.suggest3"),
  ];

  return (
    <section className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--primary)]/10 text-[var(--primary)]">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 3v-3z"
            />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-slate-900">{t("assistant.title")}</h3>
          <p className="text-sm text-slate-500">{t("assistant.readonlyNote")}</p>
        </div>
      </div>

      {messages.length > 0 && (
        <div className="mt-4 space-y-3">
          {messages.map((m, i) => (
            <div
              key={i}
              className={m.role === "user" ? "flex justify-end" : "flex justify-start"}
            >
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm ${
                  m.role === "user"
                    ? "bg-[var(--primary)] text-white"
                    : "bg-white text-slate-700 border border-slate-200"
                }`}
              >
                {m.text}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-400">
                {t("assistant.thinking")}
              </div>
            </div>
          )}
        </div>
      )}

      {messages.length === 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => ask(s)}
              disabled={loading}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)] disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
        className="mt-4 flex items-center gap-2"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("assistant.placeholder")}
          maxLength={500}
          className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm text-slate-900 focus:border-[var(--primary)] focus:outline-none"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="flex-shrink-0 rounded-xl bg-[var(--primary)] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[var(--primary-light)] disabled:opacity-50"
        >
          {t("assistant.ask")}
        </button>
      </form>
    </section>
  );
}
