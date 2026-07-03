"use client";

/**
 * AI assistant on the ANONYMOUS generation-result view (pre-save).
 *
 * Talks to POST /api/ai/assistant-anon (unauthenticated, rate-limited). It can
 * answer questions AND propose a day-scoped edit ("make day 2 cheaper"). Edits
 * are never auto-applied: the panel renders a preview card and, on confirm,
 * calls `onApplyDay` so the parent swaps that day into the in-memory itinerary.
 * Nothing is persisted until the user saves the trip.
 *
 * Discoverability audit 2026-07-01, Tier 3-B1 (Q&A) + B2 (editing).
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { capture } from "@/lib/posthog/events";
import type { Activity, ItineraryDay } from "@/types";

interface AnonEdit {
  day_number: number;
  summary: string;
  activities: Activity[];
  theme?: string;
}

interface AnonAssistantPanelProps {
  destination: string;
  tripTitle: string;
  days: ItineraryDay[];
  startDate?: string;
  endDate?: string;
  /** Apply a proposed day revision to the in-memory itinerary. */
  onApplyDay: (dayNumber: number, activities: Activity[], theme?: string) => void;
}

interface Msg {
  role: "user" | "assistant";
  text: string;
  edit?: AnonEdit;
  editState?: "pending" | "applied" | "discarded";
}

export default function AnonAssistantPanel({
  destination,
  tripTitle,
  days,
  startDate,
  endDate,
  onApplyDay,
}: AnonAssistantPanelProps) {
  const t = useTranslations("trips");
  const locale = useLocale();
  const [messages, setMessages] = useState<Msg[]>([]);
  // Height-capped chat: the panel used to grow unbounded with every message,
  // pushing the itinerary further off-screen each turn (replay 019f285d).
  // Cap it and keep the newest message scrolled into view.
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = chatScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The panel is conditionally rendered only on the post-generation result
  // view, so mount === the traveller opening the assistant.
  useEffect(() => {
    capture("anon_assistant_opened", { destination, day_count: days.length });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setEditState = (idx: number, state: "applied" | "discarded") =>
    setMessages((m) => m.map((msg, i) => (i === idx ? { ...msg, editState: state } : msg)));

  const ask = async (message: string) => {
    const q = message.trim();
    if (!q || loading) return;
    setError(null);
    setInput("");
    setMessages((m) => [...m, { role: "user", text: q }]);
    capture("anon_assistant_question_asked", { destination, message_length: q.length });
    setLoading(true);
    try {
      const res = await fetch("/api/ai/assistant-anon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: q,
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
      const payload = data?.data ?? data ?? {};
      const reply: string = payload.reply ?? "";
      const edit: AnonEdit | undefined =
        payload.edit && Array.isArray(payload.edit.activities) && payload.edit.activities.length
          ? (payload.edit as AnonEdit)
          : undefined;
      if (reply || edit) {
        setMessages((m) => [
          ...m,
          { role: "assistant", text: reply, edit, editState: edit ? "pending" : undefined },
        ]);
        if (edit) {
          capture("anon_assistant_edit_proposed", { destination, day_number: edit.day_number });
        }
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
          <p className="text-sm text-slate-500">{t("assistant.note")}</p>
        </div>
      </div>

      {messages.length > 0 && (
        <div
          ref={chatScrollRef}
          className="mt-4 max-h-[420px] space-y-3 overflow-y-auto pr-1"
        >
          {messages.map((m, i) => (
            <div key={i}>
              <div className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div
                  className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm ${
                    m.role === "user"
                      ? "bg-[var(--primary)] text-white"
                      : "border border-slate-200 bg-white text-slate-700"
                  }`}
                >
                  {m.text}
                </div>
              </div>

              {/* Edit preview / confirm card */}
              {m.edit && (
                <div className="mt-2 rounded-xl border border-[var(--primary)]/30 bg-[var(--primary)]/5 p-3">
                  <p className="text-sm font-semibold text-slate-900">
                    {t("assistant.editPreview", { number: m.edit.day_number })}
                  </p>
                  <p className="mt-0.5 text-sm text-slate-600">{m.edit.summary}</p>
                  <ul className="mt-2 space-y-1">
                    {m.edit.activities.map((a, j) => (
                      <li key={j} className="flex items-center gap-2 text-sm text-slate-700">
                        <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[var(--primary)]" />
                        {a.name}
                      </li>
                    ))}
                  </ul>
                  {m.editState === "pending" ? (
                    <div className="mt-3 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          onApplyDay(m.edit!.day_number, m.edit!.activities, m.edit!.theme);
                          capture("anon_assistant_edit_applied", {
                            destination,
                            day_number: m.edit!.day_number,
                          });
                          setEditState(i, "applied");
                        }}
                        className="rounded-lg bg-[var(--primary)] px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[var(--primary-light)]"
                      >
                        {t("assistant.apply")}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          capture("anon_assistant_edit_discarded", {
                            destination,
                            day_number: m.edit!.day_number,
                          });
                          setEditState(i, "discarded");
                        }}
                        className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100"
                      >
                        {t("assistant.discard")}
                      </button>
                    </div>
                  ) : (
                    <p
                      className={`mt-2 text-sm font-medium ${
                        m.editState === "applied" ? "text-emerald-600" : "text-slate-400"
                      }`}
                    >
                      {m.editState === "applied"
                        ? `✓ ${t("assistant.applied")}`
                        : t("assistant.discard")}
                    </p>
                  )}
                </div>
              )}
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
