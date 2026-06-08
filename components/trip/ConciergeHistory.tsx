"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Compass, ChevronDown, ChevronUp, Sparkles } from "lucide-react";

/**
 * In-trip Concierge conversation history (F4 follow-up, 2026-06-07).
 *
 * Renders past Q&A pairs with the Concierge for THIS trip, newest first,
 * inside a collapsible section that sits below the Concierge launcher
 * on the trip-detail page.
 *
 * Why this exists: the david-cassoni postmortem revealed that the
 * Concierge persisted no chat history. The Q&A pairs were paid for
 * (Gemini tokens) but invisible — the user couldn't refer back, and
 * we couldn't mine common asks for FAQ / template work. Persistence
 * landed in commit 8d8f591; this component surfaces it.
 *
 * Design:
 *   - Collapsed by default. No clutter for users who haven't chatted yet.
 *   - Empty state hides the whole panel (no "you have no chats" noise).
 *   - Latest 100 turns. Trips with more aren't a realistic v1 concern.
 *   - Lazy fetch — only hits the API when the user expands the section.
 *     Saves a roundtrip on the (common) case where the user never opens
 *     the history.
 *   - Mode-aware badge: live-trip answers ("today" mode) are tagged so
 *     the user remembers which questions had today's context injected.
 */
interface ConciergeHistoryProps {
  tripId: string;
  className?: string;
}

interface ConciergeTurn {
  id: string;
  question: string;
  answer: string;
  is_live_trip: boolean | null;
  day_number: number | null;
  created_at: string;
}

export default function ConciergeHistory({
  tripId,
  className = "",
}: ConciergeHistoryProps) {
  // Honor the same env-flag kill switch as the launcher — there's no
  // point showing history for a feature that isn't enabled in this
  // environment.
  if (process.env.NEXT_PUBLIC_CONCIERGE_ENABLED !== "true") {
    return null;
  }
  return <ConciergeHistoryInner tripId={tripId} className={className} />;
}

function ConciergeHistoryInner({ tripId, className }: ConciergeHistoryProps) {
  const t = useTranslations("common.concierge");

  const [isOpen, setIsOpen] = useState(false);
  const [turns, setTurns] = useState<ConciergeTurn[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lazy fetch on first expand. We DON'T re-fetch on each expand —
  // closing+reopening shouldn't re-hit the API. New questions will
  // require a page refresh to surface; that's an acceptable v1 limit
  // and lines up with the Concierge being single-turn anyway.
  useEffect(() => {
    if (!isOpen || turns !== null || loading) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`/api/trips/${tripId}/concierge-history`, {
          cache: "no-store",
        });
        if (!res.ok) {
          throw new Error(`history ${res.status}`);
        }
        const data = (await res.json()) as { turns: ConciergeTurn[] };
        if (!cancelled) {
          setTurns(data.turns ?? []);
        }
      } catch (err) {
        console.error("[concierge-history] fetch failed", err);
        if (!cancelled) {
          setError(t("historyError"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, tripId, turns, loading, t]);

  // While we don't know yet whether there's any history, render
  // nothing — so the panel doesn't flash in for users who never used
  // Concierge. Once the user expands, even an empty list shows the
  // header so they understand the affordance.
  const hasTurns = (turns?.length ?? 0) > 0;

  // Hide the whole section on first paint until we know there's
  // history. After expanding once with zero turns the user gets an
  // empty-state hint, but on initial trip-detail mount we keep it
  // out of the way.
  if (!isOpen && turns === null) {
    return (
      <div className={className}>
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="w-full text-left text-sm text-slate-500 hover:text-slate-700 flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-slate-50 transition-colors"
          aria-expanded="false"
        >
          <Compass className="w-4 h-4" aria-hidden="true" />
          <span className="font-medium">{t("historyToggle")}</span>
          <ChevronDown className="w-4 h-4 ml-auto" aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white overflow-hidden ${className}`}
    >
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors"
        aria-expanded={isOpen}
      >
        <Compass className="w-4 h-4 text-violet-500" aria-hidden="true" />
        <span className="text-sm font-medium text-slate-700">
          {t("historyToggle")}
        </span>
        {hasTurns && (
          <span className="text-xs text-slate-500">
            {t("historyCount", { count: turns!.length })}
          </span>
        )}
        {isOpen ? (
          <ChevronUp className="w-4 h-4 text-slate-400 ml-auto" aria-hidden="true" />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-400 ml-auto" aria-hidden="true" />
        )}
      </button>

      {isOpen && (
        <div className="px-4 py-4 space-y-3 max-h-96 overflow-y-auto">
          {loading && (
            <p className="text-sm text-slate-500">{t("historyLoading")}</p>
          )}
          {error && (
            <p className="text-sm text-rose-600">{error}</p>
          )}
          {!loading && !error && turns !== null && turns.length === 0 && (
            <p className="text-sm text-slate-500">{t("historyEmpty")}</p>
          )}
          {!loading &&
            !error &&
            turns?.map((turn) => (
              <article
                key={turn.id}
                className="rounded-lg border border-slate-100 bg-slate-50/50 p-3 space-y-2"
              >
                <header className="flex items-center gap-2 text-xs text-slate-500">
                  <time dateTime={turn.created_at}>
                    {formatRelative(turn.created_at)}
                  </time>
                  {turn.is_live_trip && (
                    <span className="inline-flex items-center gap-1 text-violet-700 bg-violet-50 border border-violet-100 rounded px-1.5 py-0.5">
                      <Sparkles className="w-3 h-3" aria-hidden="true" />
                      {turn.day_number != null
                        ? t("historyLiveTripDay", { day: turn.day_number })
                        : t("historyLiveTrip")}
                    </span>
                  )}
                </header>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-0.5">
                    {t("yourQuestion")}
                  </p>
                  <p className="text-sm text-slate-700 whitespace-pre-wrap">
                    {turn.question}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-0.5">
                    {t("answer")}
                  </p>
                  <p className="text-sm text-slate-700 whitespace-pre-wrap">
                    {turn.answer}
                  </p>
                </div>
              </article>
            ))}
        </div>
      )}
    </div>
  );
}

/**
 * Format an ISO timestamp as a short relative phrase ("3h ago", "2d ago").
 * Avoids the date-fns dependency this component would otherwise need.
 * Falls back to a locale date string for anything older than 30 days.
 */
function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diffSec = Math.max(0, (Date.now() - then) / 1000);
  if (diffSec < 60) return `${Math.round(diffSec)}s ago`;
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h ago`;
  if (diffSec < 86400 * 30) return `${Math.round(diffSec / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}
