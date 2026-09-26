"use client";

/**
 * AI assistant on the ANONYMOUS generation-result view (pre-save).
 *
 * Talks to POST /api/ai/assistant-anon (unauthenticated, rate-limited). It can
 * answer questions AND propose edits ("make day 2 cheaper", "swap days 2 and
 * 5", "add a day in Lyngen"). One reply can change several days and the trip's
 * length. Edits are never auto-applied: the panel renders a preview card and,
 * on confirm, calls `onApplyEdits` so the parent swaps those days into the
 * in-memory itinerary (which the wizard's auto-save persists for a saved trip).
 *
 * Discoverability audit 2026-07-01, Tier 3-B1 (Q&A) + B2 (editing).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { deriveRefineSuggestions } from "@/lib/trip/refine-suggestions";
import { decideAssistantBridge } from "@/lib/trip/assistant-bridge";
import { captureRefineSuggestionClicked } from "@/lib/posthog/events";
import { capture } from "@/lib/posthog/events";
import type { Activity, ItineraryDay } from "@/types";

interface AnonEdit {
  day_number: number;
  summary: string;
  activities: Activity[];
  theme?: string;
  city?: string;
}

interface AnonAssistantPanelProps {
  destination: string;
  tripTitle: string;
  days: ItineraryDay[];
  startDate?: string;
  endDate?: string;
  /**
   * Language the itinerary was generated in. Sent instead of the UI locale
   * so an edit never answers in a different language than the plan
   * (Phase 1.3). Undefined for older drafts → UI locale.
   */
  language?: string;
  /** Apply one reply's day revisions (and new trip length, if any) to the in-memory itinerary. */
  onApplyEdits: (edits: AnonEdit[], tripLength?: number) => void;
  /**
   * Save Sprint T5: when provided, an applied edit renders a save bridge
   * ("these edits live only in this draft → save to keep them") that invokes
   * the parent's save flow. The parent passes undefined once the trip is
   * persisted (either save arm), which also hides the bridge retroactively.
   */
  onRequestSave?: () => void;
  /**
   * The deliverable. Rendered inside the post-conversation bridge so the
   * refiner can walk away WITH the plan (a share link needs no account)
   * rather than only being asked to create one. Composition, not a new
   * dependency — the parent owns the share machinery. Same pattern as
   * SharedTripView's engagementSlot.
   */
  shareSlot?: React.ReactNode;
}

interface Msg {
  role: "user" | "assistant";
  text: string;
  /** Every day the reply changes. */
  edits?: AnonEdit[];
  /** The trip's new length, when the reply adds or removes days. */
  tripLength?: number;
  editState?: "pending" | "applied" | "discarded";
}

export default function AnonAssistantPanel({
  destination,
  tripTitle,
  days,
  startDate,
  endDate,
  language,
  onApplyEdits,
  onRequestSave,
  shareSlot,
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
  // view, so mount === the traveller seeing the assistant.
  //
  // Save Sprint T6 (hygiene): the result subtree unmounts during every
  // `generating` pass, so this used to re-fire once per generation —
  // inflating "opened" counts for multi-generation sessions. A sessionStorage
  // once-flag caps it at one per browser session. Event name + properties
  // unchanged. If storage is blocked (private mode) we keep the legacy
  // fire-per-mount behavior rather than losing the event entirely.
  useEffect(() => {
    try {
      if (sessionStorage.getItem("mt_assistant_opened_captured") === "1") return;
      sessionStorage.setItem("mt_assistant_opened_captured", "1");
    } catch {
      // Storage unavailable — fall through to the capture below.
    }
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
    // The conversation so far, so "yes" or "No I mean…" can be understood
    // (the model used to see only this one message).
    const history = messages.slice(-6).map((m) => ({ role: m.role, text: m.text.slice(0, 1500) }));
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
          locale: language ?? locale,
          history,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The server's text is English and never reached the reader (its
        // `error` is a string); a daily cap read "try again in a moment".
        const reason = typeof data?.reason === "string" ? data.reason : "";
        setError(
          res.status === 429 && reason === "daily_anon"
            ? t("assistant.limitDailyAnon")
            : res.status === 429 && reason === "daily_user"
              ? t("assistant.limitDailyUser")
              : res.status >= 500
                ? t("assistant.errorBig")
                : t("assistant.errorMsg")
        );
        return;
      }
      const payload = data?.data ?? data ?? {};
      const reply: string = payload.reply ?? "";
      // "edits" (several days) or the older single "edit".
      const rawEdits: unknown[] = Array.isArray(payload.edits) ? payload.edits : payload.edit ? [payload.edit] : [];
      const edits = rawEdits.filter(
        (e): e is AnonEdit => !!e && Array.isArray((e as AnonEdit).activities) && (e as AnonEdit).activities.length > 0
      );
      const tripLength: number | undefined = typeof payload.tripLength === "number" ? payload.tripLength : undefined;
      const changes = edits.length > 0 || tripLength !== undefined;
      if (reply || changes) {
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            text: reply,
            edits: changes ? edits : undefined,
            tripLength,
            editState: changes ? "pending" : undefined,
          },
        ]);
        if (changes) {
          capture("anon_assistant_edit_proposed", {
            destination,
            day_number: edits[0]?.day_number,
            day_count: edits.length,
            trip_length: tripLength,
          });
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

  // Suggestions derived from THIS itinerary, falling back to the static chips.
  //
  // The static chips ("Make day 1 more relaxed") shipped months ago and
  // result→save_clicked never moved: 24.9% → 24.7%. They're wallpaper — the
  // same three strings whatever we generated. The 2026-08-01 funnel read says
  // the sessions that refine are the ones that keep (9.7% save at one
  // generation vs 26.3% at three), so the chip has to earn the first tap by
  // being an observation about the plan on screen, not a generic offer.
  // Falls back rather than inventing a flaw the itinerary doesn't have.
  // The bridge shows once the assistant has actually answered — that is the
  // moment of investment, whether or not the exchange produced an edit. It
  // stays hidden after the trip is persisted, because the parent then passes
  // neither onRequestSave nor a shareSlot.
  const {
    show: showBridge,
    mode: bridgeMode,
    source: bridgeSource,
  } = decideAssistantBridge({
    messages,
    canSave: !!onRequestSave,
    canShare: !!shareSlot,
  });

  // Report the bridge once per mode. Firing it where the edit is applied (as
  // the old code did) missed the Q&A-only half entirely, which is exactly the
  // population that was never asked.
  const bridgeShownRef = useRef<string | null>(null);
  useEffect(() => {
    if (!showBridge || bridgeShownRef.current === bridgeMode) return;
    bridgeShownRef.current = bridgeMode;
    capture("save_nudge_shown", { source: bridgeSource });
  }, [showBridge, bridgeMode, bridgeSource]);

  const derived = useMemo(() => deriveRefineSuggestions(days), [days]);
  const suggestions: { label: string; prompt: string; source: string }[] =
    derived.length > 0
      ? derived.map((d) => ({
          label: t(`assistant.dyn.${d.key}`, d.params),
          prompt: d.prompt,
          source: d.key,
        }))
      : ([1, 2, 3] as const).map((n) => ({
          label: t(`assistant.suggest${n}`),
          prompt: t(`assistant.suggest${n}`),
          source: `static${n}`,
        }));

  return (
    <section className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--primary)]/10 text-[var(--primary-ink)]">
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

              {/* Edit preview / confirm card: every day the reply changes */}
              {m.editState && (m.edits?.length || m.tripLength !== undefined) && (
                <div className="mt-2 rounded-xl border border-[var(--primary)]/30 bg-[var(--primary)]/5 p-3">
                  {m.edits && m.edits.length > 0 && (
                    <p className="text-sm font-semibold text-slate-900">
                      {m.edits.length === 1
                        ? t("assistant.editPreview", { number: m.edits[0].day_number })
                        : t("assistant.editPreviewDays", { days: m.edits.map((e) => e.day_number).join(", ") })}
                    </p>
                  )}
                  {m.tripLength !== undefined && (
                    <p className="mt-0.5 text-sm font-medium text-slate-800">
                      {t("assistant.tripLength", { count: m.tripLength, date: endOfTrip(startDate, m.tripLength, locale) })}
                    </p>
                  )}
                  {(m.edits ?? []).map((e) => (
                    <div key={e.day_number} className="mt-2">
                      {(m.edits?.length ?? 0) > 1 && (
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {t("day.label", { number: e.day_number })}
                          {e.city ? ` · ${e.city}` : ""}
                        </p>
                      )}
                      {e.summary && <p className="mt-0.5 text-sm text-slate-600">{e.summary}</p>}
                      <ul className="mt-1 space-y-1">
                        {e.activities.map((a, j) => (
                          <li key={j} className="flex items-center gap-2 text-sm text-slate-700">
                            <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[var(--primary)]" />
                            {a.name}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                  {m.editState === "pending" ? (
                    <div className="mt-3 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          onApplyEdits(m.edits ?? [], m.tripLength);
                          capture("anon_assistant_edit_applied", {
                            destination,
                            day_number: m.edits?.[0]?.day_number,
                            day_count: m.edits?.length ?? 0,
                            trip_length: m.tripLength,
                          });
                          // Save Sprint T5: the keep-your-edits save bridge
                          // renders with the "applied" state below — one
                          // shown-event per applied edit, only when the
                          // bridge will actually render (trip still unsaved).
                          if (onRequestSave) {
                          }
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
                            day_number: m.edits?.[0]?.day_number,
                            day_count: m.edits?.length ?? 0,
                          });
                          setEditState(i, "discarded");
                        }}
                        className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100"
                      >
                        {t("assistant.discard")}
                      </button>
                    </div>
                  ) : (
                    <>
                      <p
                        className={`mt-2 text-sm font-medium ${
                          m.editState === "applied" ? "text-emerald-600" : "text-slate-500"
                        }`}
                      >
                        {m.editState === "applied"
                          ? `✓ ${t("assistant.applied")}`
                          : t("assistant.discard")}
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-500">
                {t("assistant.thinking")}
              </div>
            </div>
          )}

          {/* One bridge, below the whole conversation, for BOTH halves.
              It used to live inside the edit card and fire only on
              editState === "applied", so a session that just ASKED questions
              was never offered anything at all. Measured 30 days to 2026-09-02:
              70 sessions proposed an edit and clicked Save 57.1% of the time;
              50 asked questions only, saw nothing, and clicked Save 34.0%.
              The share slot comes first deliberately — a link is a deliverable
              they can keep with no account, and #93's keep-it nudge rides on
              it; the save ask is the secondary path, not the only one. */}
          {showBridge && (
            <div
              className="mt-1 rounded-xl border border-[var(--primary)]/20 bg-[var(--background-warm)] p-3"
              data-assistant-bridge
              data-bridge-mode={bridgeMode}
            >
              <p className="text-xs text-slate-600">
                {bridgeMode === "edit_applied"
                  ? t("assistant.keepEditsPrompt")
                  : t("assistant.keepPlanPrompt")}
              </p>
              {shareSlot && <div className="mt-2">{shareSlot}</div>}
              {onRequestSave && (
                <button
                  type="button"
                  onClick={() => {
                    capture("save_nudge_action", { source: bridgeSource, action: "save_click" });
                    onRequestSave();
                  }}
                  className="mt-2 rounded-lg bg-[var(--secondary-ink)] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[var(--secondary-ink)]/90"
                >
                  {bridgeMode === "edit_applied"
                    ? t("assistant.keepEditsButton")
                    : t("assistant.keepPlanButton")}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {messages.length === 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button
              key={s.source}
              type="button"
              onClick={() => {
                // `source` distinguishes derived chips from the static
                // fallback, so the funnel can tell whether specificity is what
                // earned the tap — the whole point of the change.
                void captureRefineSuggestionClicked({ source: s.source, derived: derived.length > 0 });
                ask(s.prompt);
              }}
              disabled={loading}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 transition-colors hover:border-[var(--primary)] hover:text-[var(--primary-ink)] disabled:opacity-50"
            >
              {s.label}
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

/** The trip's last day for a new length, in the reader's format ("14 Nov"). */
function endOfTrip(startDate: string | undefined, days: number, locale: string): string {
  if (!startDate) return "";
  const d = new Date(`${startDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  d.setUTCDate(d.getUTCDate() + days - 1);
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(d);
}
