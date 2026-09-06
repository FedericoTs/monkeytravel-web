"use client";

/**
 * Today view — Live Trip plan, Phase 3.2 + 3.3. The daily open, and the
 * four-button front door to acting on a live trip.
 *
 * 3.2: when a trip is live, owner and participants land here — today's date
 * and weather, the activity happening now (or next), the rest of today, a
 * one-line tomorrow preview, and yesterday collapsed. "Now / Next" compares
 * each start_time to the wall clock IN THE TRIP'S timezone, so it is the same
 * for everyone. Reuses ActivityCard, the renderer /shared already uses.
 *
 * 3.3: above today's list, four chips — Running late · Skip this · Swap
 * nearby · Done for today. Each writes to trip_today_actions (never the
 * owner's itinerary), overlays on everyone's Today in real time
 * (useTodayActions), carries the participant's name, and has a one-tap undo.
 * Swap nearby asks the AI agent for one nearby alternative.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { Activity, ItineraryDay } from "@/types";
import type { TripDayState } from "@/lib/trip/live";
import ActivityCard from "@/components/ActivityCard";
import TodayPacking from "@/components/trip/TodayPacking";
import TodayExpenses from "@/components/trip/TodayExpenses";
import ExpenseQuickAdd from "@/components/trip/ExpenseQuickAdd";
import { useTodayActions } from "@/lib/today/useTodayActions";
import { useTripExpenses } from "@/lib/expenses/useTripExpenses";
import {
  activeActions,
  feedDescriptor,
  isDayDone,
  overlayFor,
  runningLateMinutes,
  type TodayAction,
  type TodayActionType,
} from "@/lib/today/actions";

interface TodayViewProps {
  itinerary: ItineraryDay[];
  dayState: TripDayState; // must be live (caller gates on isLive)
  currency?: string;
  weatherNote?: string;
  onViewFullItinerary: () => void;
  /** Trip id + share token enable the chips (Phase 3.3); omit to show a read-only Today. */
  tripId?: string;
  shareToken?: string;
  /** The trip's packing list, for the "Packed?" checklist (Phase 3.4). */
  packingItems?: string[];
  className?: string;
}

function nowHHMMInZone(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  }
}
function toMinutes(hhmm: string | undefined | null): number | null {
  if (!hhmm || typeof hhmm !== "string") return null;
  const m = hhmm.match(/^(\d{1,2}):(\d{2})/);
  return m ? +m[1] * 60 + +m[2] : null;
}

export default function TodayView({
  itinerary,
  dayState,
  currency,
  weatherNote,
  onViewFullItinerary,
  tripId,
  shareToken,
  packingItems,
  className = "",
}: TodayViewProps) {
  const t = useTranslations("common");
  const tw = useTranslations("trips");

  const dayNumber = dayState.dayNumber ?? 1;
  const today = useMemo(() => itinerary.find((d) => d.day_number === dayNumber), [itinerary, dayNumber]);
  const tomorrow = useMemo(() => itinerary.find((d) => d.day_number === dayNumber + 1), [itinerary, dayNumber]);
  const yesterday = useMemo(() => itinerary.find((d) => d.day_number === dayNumber - 1), [itinerary, dayNumber]);

  // Phase 3.3 overlay (realtime). Enabled only when we have a share token.
  const chipsEnabled = !!shareToken && !!tripId;
  const { actions, busy, error, apply, undo } = useTodayActions(shareToken ?? "", tripId ?? "", chipsEnabled);
  // Phase 3.4 expenses: "Who paid?" on the live trip, split across participants.
  const expenses = useTripExpenses(shareToken ?? "", chipsEnabled);
  const activityNameOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of itinerary) for (const a of d.activities ?? []) if (a?.id) map.set(a.id, a.name);
    return (id: string | null) => (id ? map.get(id) ?? null : null);
  }, [itinerary]);

  const [nowMin, setNowMin] = useState<number | null>(() => (dayState.timeZone ? toMinutes(nowHHMMInZone(dayState.timeZone)) : null));
  useEffect(() => {
    if (!dayState.timeZone) return;
    const tick = () => setNowMin(toMinutes(nowHHMMInZone(dayState.timeZone!)));
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [dayState.timeZone]);

  const activities = useMemo(() => (today?.activities ?? []).filter((a): a is Activity => !!a), [today]);

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

  const shiftMinutes = useMemo(() => runningLateMinutes(actions, dayNumber), [actions, dayNumber]);
  const dayDone = useMemo(() => isDayDone(actions, dayNumber), [actions, dayNumber]);

  const dateLabel = useMemo(() => {
    if (!dayState.todayLocalDate) return "";
    try {
      return new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(
        new Date(dayState.todayLocalDate + "T00:00:00Z"),
      );
    } catch {
      return dayState.todayLocalDate;
    }
  }, [dayState.todayLocalDate]);

  const [showYesterday, setShowYesterday] = useState(false);

  // Chip click = toggle: undo my active action of that (type, target), else apply.
  const myActive = (type: TodayActionType, activityId: string | null): TodayAction | undefined =>
    activeActions(actions, dayNumber).find(
      (a) => a.mine && a.action_type === type && (a.activity_id ?? null) === activityId,
    );
  const toggle = (type: TodayActionType, activity?: Activity) => {
    const mine = myActive(type, activity?.id ?? null);
    if (mine) void undo(mine.id);
    else void apply({ action_type: type, day_number: dayNumber, activity });
  };

  // Render an activity with its overlay: shifted time, skipped/done marks, swap note.
  const renderActivity = (activity: Activity, index: number, canActOn: boolean) => {
    const o = overlayFor(activity, actions, dayNumber, shiftMinutes);
    const shown: Activity = o.displayStartTime && o.displayStartTime !== activity.start_time ? { ...activity, start_time: o.displayStartTime } : activity;
    const mySkip = myActive("skip", activity.id ?? null);
    const mySwap = myActive("swap", activity.id ?? null);
    return (
      <div key={activity.id ?? `${activity.name}-${index}`} className={o.skipped || o.done ? "opacity-60" : ""}>
        {(o.skipped || o.done) && (
          <p className="mb-1 text-xs font-medium text-slate-500">
            {o.skipped ? t("today.chips.skippedBy", { name: o.skippedBy || t("today.someone") }) : t("today.chips.doneMark")}
          </p>
        )}
        <div className={o.skipped ? "line-through decoration-slate-300" : ""}>
          <ActivityCard activity={shown} index={index} currency={currency} disableAutoFetch />
        </div>
        {o.swap && (
          <p className="mt-1 rounded-lg bg-[var(--secondary)]/10 px-3 py-2 text-xs text-slate-700">
            <span className="font-semibold">{t("today.chips.swapPrefix", { name: o.swapBy || t("today.someone") })}</span> {o.swap.name}
            {o.swap.why ? ` — ${o.swap.why}` : ""}
          </p>
        )}
        {chipsEnabled && (
          <div className="mt-1.5 flex flex-wrap gap-2">
            {canActOn && (
              <>
                <button
                  type="button"
                  onClick={() => toggle("skip", activity)}
                  disabled={busy}
                  data-testid="chip-skip"
                  className={chipClass(!!mySkip)}
                >
                  {mySkip ? t("today.chips.skipUndo") : t("today.chips.skip")}
                </button>
                <button
                  type="button"
                  onClick={() => toggle("swap", activity)}
                  disabled={busy}
                  data-testid="chip-swap"
                  className={chipClass(!!mySwap)}
                >
                  {busy && !mySwap ? t("today.chips.swapping") : mySwap ? t("today.chips.swapUndo") : t("today.chips.swap")}
                </button>
              </>
            )}
            {/* Phase 3.4: "Who paid?" on each activity. */}
            <ExpenseQuickAdd
              onAdd={(amt) => expenses.add({ amount: amt, activityId: activity.id ?? null })}
              busy={expenses.busy}
            />
          </div>
        )}
      </div>
    );
  };

  // The activity feed: recent active actions, newest first, localized.
  const feed = useMemo(() => {
    const nameOf = (id: string | null) => activities.find((a) => a.id === id)?.name ?? null;
    return activeActions(actions, dayNumber)
      .slice()
      .reverse()
      .slice(0, 5)
      .map((a) => {
        const d = feedDescriptor(a, nameOf(a.activity_id));
        const who = d.who.kind === "name" ? d.who.name ?? t("today.someone") : d.who.kind === "owner" ? t("today.owner") : t("today.someone");
        const what = t(`today.feed.${d.key}`, {
          activity: d.params.activity ?? t("today.someActivity"),
          minutes: d.params.minutes ?? 0,
          to: d.params.to ?? "",
        });
        return { id: a.id, who, what };
      });
  }, [actions, dayNumber, activities, t]);

  const myRunningLate = myActive("running_late", null);
  const myDayDone = myActive("done", null);

  return (
    <section data-testid="today-view" className={className} aria-label={t("today.title")}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
        <h2 className="text-xl font-bold text-slate-900">
          {t("today.title")}
          <span className="ml-2 text-sm font-medium text-[var(--primary-ink)]">{t("today.dayOf", { day: dayNumber, total: dayState.totalDays })}</span>
        </h2>
        <button type="button" onClick={onViewFullItinerary} data-testid="today-view-full" className="text-sm font-medium text-slate-600 hover:text-slate-900 underline-offset-2 hover:underline">
          {t("today.viewFull")}
        </button>
      </div>
      <p className="text-sm text-slate-600 mb-1 capitalize">{dateLabel}</p>
      {dayState.timeZoneSource === "viewer" && <p className="text-xs text-slate-400 mb-3">{t("today.deviceTzNote")}</p>}

      {weatherNote && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
          <span aria-hidden>☀️</span>
          <p className="text-sm text-amber-900">{weatherNote}</p>
        </div>
      )}

      {/* Packed? — day 1 open, later days collapsed (Phase 3.4). */}
      {tripId && packingItems && packingItems.length > 0 && (
        <TodayPacking items={packingItems} tripId={tripId} defaultOpen={dayNumber <= 1} className="mb-4" />
      )}

      {/* Day-level chips + status */}
      {chipsEnabled && !dayDone && activities.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2" data-testid="today-chips">
          <button type="button" onClick={() => toggle("running_late")} disabled={busy} data-testid="chip-running-late" className={chipClass(!!myRunningLate)}>
            {myRunningLate ? t("today.chips.runningLateUndo") : t("today.chips.runningLate")}
          </button>
          <button type="button" onClick={() => toggle("done")} disabled={busy} data-testid="chip-done" className={chipClass(false)}>
            {t("today.chips.done")}
          </button>
          {shiftMinutes > 0 && <span className="text-xs font-medium text-[var(--primary-ink)]">{t("today.chips.shiftedBy", { minutes: shiftMinutes })}</span>}
        </div>
      )}
      {error && <p className="mb-3 text-xs text-red-600" role="alert">{error}</p>}

      {/* Feed */}
      {feed.length > 0 && (
        <ul className="mb-4 space-y-1" data-testid="today-feed">
          {feed.map((f) => (
            <li key={f.id} className="text-xs text-slate-500">
              <span className="font-semibold text-slate-700">{f.who}</span> {f.what}
            </li>
          ))}
        </ul>
      )}

      {/* Expenses — "Who paid?" split across participants (Phase 3.4). */}
      {chipsEnabled && (
        <TodayExpenses
          expenses={expenses.expenses}
          summary={expenses.summary}
          busy={expenses.busy}
          error={expenses.error}
          onAdd={(amt) => expenses.add({ amount: amt })}
          onRemove={expenses.remove}
          activityName={activityNameOf}
          className="mb-4"
        />
      )}

      {dayDone ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-6 text-center" data-testid="today-day-done">
          <p className="text-sm font-semibold text-emerald-800">{t("today.chips.dayComplete")}</p>
          {myDayDone && (
            <button type="button" onClick={() => void undo(myDayDone.id)} disabled={busy} className="mt-2 text-xs text-emerald-700 underline-offset-2 hover:underline">
              {t("today.chips.reopenDay")}
            </button>
          )}
        </div>
      ) : activities.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">{t("today.nothingToday")}</p>
      ) : (
        <>
          {highlight && (
            <div className="mb-5">
              <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-[var(--primary-ink)]">{currentIndex >= 0 ? t("today.now") : t("today.next")}</p>
              <div data-testid="today-highlight" className="ring-2 ring-[var(--primary)]/30 rounded-xl">
                {renderActivity(highlight, highlightIndex, true)}
              </div>
            </div>
          )}
          {rest.length > 0 && (
            <div className="mb-5">
              <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">{t("today.restOfDay")}</p>
              <div className="space-y-4">{rest.map((activity, i) => renderActivity(activity, highlightIndex + 1 + i, false))}</div>
            </div>
          )}
        </>
      )}

      {tomorrow && (
        <button type="button" onClick={onViewFullItinerary} data-testid="today-tomorrow" className="mb-3 flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-left hover:bg-slate-50">
          <span className="min-w-0">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{t("today.tomorrow")}</span>
            <span className="mt-0.5 block truncate text-sm text-slate-700">{tw("today.tomorrowSummary", { count: tomorrow.activities?.length ?? 0, first: tomorrow.activities?.[0]?.name ?? "" })}</span>
          </span>
          <span aria-hidden className="text-slate-400">→</span>
        </button>
      )}

      {yesterday && (
        <div className="mb-1">
          <button type="button" onClick={() => setShowYesterday((v) => !v)} className="flex w-full items-center justify-between rounded-xl px-4 py-2 text-left text-sm text-slate-500 hover:bg-slate-50" aria-expanded={showYesterday}>
            <span>{t("today.yesterday")}</span>
            <span aria-hidden>{showYesterday ? "▴" : "▾"}</span>
          </button>
          {showYesterday && (
            <div className="mt-2 space-y-3">
              {(yesterday.activities ?? []).map((activity, i) => (
                <ActivityCard key={activity.id ?? `y-${i}`} activity={activity} index={i} currency={currency} disableAutoFetch />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function chipClass(active: boolean): string {
  return active
    ? "inline-flex min-h-[36px] items-center gap-1.5 rounded-full bg-[var(--primary)] px-3.5 text-sm font-semibold text-white disabled:opacity-60"
    : "inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60";
}
