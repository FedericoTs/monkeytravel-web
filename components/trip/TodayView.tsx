"use client";

/**
 * Today view — Live Trip plan, Phase 3.2. The daily open.
 *
 * When a trip is live, owner and participants land here instead of on the top
 * of a 20-screen itinerary: today's date and weather, the activity happening
 * now (or next), the rest of today, a one-line tomorrow preview, and
 * yesterday collapsed. "Now / Next" is decided by comparing each activity's
 * start_time to the current wall-clock time IN THE TRIP'S timezone, so it is
 * the same for everyone looking, wherever they are.
 *
 * Reuses ActivityCard (the read-only renderer /shared already uses), so a
 * participant sees exactly what the owner sees. The chips (Phase 3.3) and the
 * activity feed (3.5) attach here later; this is the surface they need.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { Activity, ItineraryDay } from "@/types";
import type { TripDayState } from "@/lib/trip/live";
import ActivityCard from "@/components/ActivityCard";

interface TodayViewProps {
  itinerary: ItineraryDay[];
  dayState: TripDayState; // must be live (caller gates on isLive)
  currency?: string;
  weatherNote?: string;
  onViewFullItinerary: () => void;
  className?: string;
}

/** "HH:MM" now in the given IANA zone (24h). */
function nowHHMMInZone(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  }
}

/** Minutes since midnight for an "HH:MM" string; null when unparseable. */
function toMinutes(hhmm: string | undefined | null): number | null {
  if (!hhmm || typeof hhmm !== "string") return null;
  const m = hhmm.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return +m[1] * 60 + +m[2];
}

export default function TodayView({
  itinerary,
  dayState,
  currency,
  weatherNote,
  onViewFullItinerary,
  className = "",
}: TodayViewProps) {
  const t = useTranslations("common");
  const tw = useTranslations("trips");

  const dayNumber = dayState.dayNumber ?? 1;
  const today = useMemo(() => itinerary.find((d) => d.day_number === dayNumber), [itinerary, dayNumber]);
  const tomorrow = useMemo(() => itinerary.find((d) => d.day_number === dayNumber + 1), [itinerary, dayNumber]);
  const yesterday = useMemo(() => itinerary.find((d) => d.day_number === dayNumber - 1), [itinerary, dayNumber]);

  // Re-evaluate "now" every minute so the current activity advances on its own.
  const [nowMin, setNowMin] = useState<number | null>(() =>
    dayState.timeZone ? toMinutes(nowHHMMInZone(dayState.timeZone)) : null,
  );
  useEffect(() => {
    if (!dayState.timeZone) return;
    const tick = () => setNowMin(toMinutes(nowHHMMInZone(dayState.timeZone!)));
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [dayState.timeZone]);

  const activities = useMemo(() => (today?.activities ?? []).filter((a): a is Activity => !!a), [today]);

  // Current = last activity already started; next = first not yet started.
  const { currentIndex, nextIndex } = useMemo(() => {
    if (nowMin === null) return { currentIndex: -1, nextIndex: activities.length ? 0 : -1 };
    let current = -1;
    let next = -1;
    for (let i = 0; i < activities.length; i++) {
      const start = toMinutes(activities[i].start_time);
      if (start === null) continue;
      if (start <= nowMin) current = i;
      else {
        next = i;
        break;
      }
    }
    if (next === -1 && current < activities.length - 1 && current >= 0) next = current + 1;
    if (current === -1 && next === -1 && activities.length) next = 0;
    return { currentIndex: current, nextIndex: next };
  }, [activities, nowMin]);

  const highlightIndex = currentIndex >= 0 ? currentIndex : nextIndex;
  const highlight = highlightIndex >= 0 ? activities[highlightIndex] : undefined;
  const rest = activities.filter((_, i) => i > highlightIndex);

  const dateLabel = useMemo(() => {
    if (!dayState.todayLocalDate) return "";
    try {
      return new Intl.DateTimeFormat(undefined, {
        weekday: "long",
        day: "numeric",
        month: "long",
        timeZone: "UTC",
      }).format(new Date(dayState.todayLocalDate + "T00:00:00Z"));
    } catch {
      return dayState.todayLocalDate;
    }
  }, [dayState.todayLocalDate]);

  const [showYesterday, setShowYesterday] = useState(false);

  return (
    <section data-testid="today-view" className={className} aria-label={t("today.title")}>
      {/* Date header */}
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
        <h2 className="text-xl font-bold text-slate-900">
          {t("today.title")}
          <span className="ml-2 text-sm font-medium text-[var(--primary-ink)]">
            {t("today.dayOf", { day: dayNumber, total: dayState.totalDays })}
          </span>
        </h2>
        <button
          type="button"
          onClick={onViewFullItinerary}
          data-testid="today-view-full"
          className="text-sm font-medium text-slate-600 hover:text-slate-900 underline-offset-2 hover:underline"
        >
          {t("today.viewFull")}
        </button>
      </div>
      <p className="text-sm text-slate-600 mb-1 capitalize">{dateLabel}</p>
      {dayState.timeZoneSource === "viewer" && (
        <p className="text-xs text-slate-400 mb-3">{t("today.deviceTzNote")}</p>
      )}

      {weatherNote && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
          <span aria-hidden>☀️</span>
          <p className="text-sm text-amber-900">{weatherNote}</p>
        </div>
      )}

      {activities.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
          {t("today.nothingToday")}
        </p>
      ) : (
        <>
          {highlight && (
            <div className="mb-5">
              <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-[var(--primary-ink)]">
                {currentIndex >= 0 ? t("today.now") : t("today.next")}
              </p>
              <div data-testid="today-highlight" className="ring-2 ring-[var(--primary)]/30 rounded-xl">
                <ActivityCard activity={highlight} index={highlightIndex} currency={currency} disableAutoFetch />
              </div>
            </div>
          )}

          {rest.length > 0 && (
            <div className="mb-5">
              <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">{t("today.restOfDay")}</p>
              <div className="space-y-3">
                {rest.map((activity, i) => (
                  <ActivityCard
                    key={activity.id ?? `${activity.name}-${i}`}
                    activity={activity}
                    index={highlightIndex + 1 + i}
                    currency={currency}
                    disableAutoFetch
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Tomorrow preview — one line, tap through to the full itinerary. */}
      {tomorrow && (
        <button
          type="button"
          onClick={onViewFullItinerary}
          data-testid="today-tomorrow"
          className="mb-3 flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-left hover:bg-slate-50"
        >
          <span className="min-w-0">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{t("today.tomorrow")}</span>
            <span className="mt-0.5 block truncate text-sm text-slate-700">
              {tw("today.tomorrowSummary", {
                count: tomorrow.activities?.length ?? 0,
                first: tomorrow.activities?.[0]?.name ?? "",
              })}
            </span>
          </span>
          <span aria-hidden className="text-slate-400">→</span>
        </button>
      )}

      {/* Yesterday — collapsed. */}
      {yesterday && (
        <div className="mb-1">
          <button
            type="button"
            onClick={() => setShowYesterday((v) => !v)}
            className="flex w-full items-center justify-between rounded-xl px-4 py-2 text-left text-sm text-slate-500 hover:bg-slate-50"
            aria-expanded={showYesterday}
          >
            <span>{t("today.yesterday")}</span>
            <span aria-hidden>{showYesterday ? "▴" : "▾"}</span>
          </button>
          {showYesterday && (
            <div className="mt-2 space-y-3">
              {(yesterday.activities ?? []).map((activity, i) => (
                <ActivityCard
                  key={activity.id ?? `y-${i}`}
                  activity={activity}
                  index={i}
                  currency={currency}
                  disableAutoFetch
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
