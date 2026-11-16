"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { BOOKED_IDS_MAX, bookAheadStops, type BookAheadStop } from "@/lib/trips/book-ahead";
import type { ItineraryDay } from "@/types";

/**
 * "Book ahead" on the saved trip, before it starts: the stops the plan marks
 * as needing a booking, by date, each with a link to book from and a "Booked"
 * tick the trip keeps (trip_meta.booked_ids). Nothing to book, nothing shown.
 */

/** Keeps the trip's ticks, for the stops the plan still has. */
async function saveBookedIds(tripId: string, ids: string[]): Promise<void> {
  const supabase = createClient();
  const { data: trip, error: readError } = await supabase.from("trips").select("trip_meta").eq("id", tripId).single();
  if (readError) throw readError;
  const meta = (trip?.trip_meta || {}) as Record<string, unknown>;
  // `.select()` because an update the row's policy refuses comes back as
  // 204 with no error: zero rows means it wasn't kept.
  const { data: rows, error } = await supabase
    .from("trips")
    .update({ trip_meta: { ...meta, booked_ids: ids.slice(0, BOOKED_IDS_MAX) }, updated_at: new Date().toISOString() })
    .eq("id", tripId)
    .select("id");
  if (error) throw error;
  if (!rows?.length) throw new Error("no row updated");
}

export default function BookAheadList({
  tripId,
  itinerary,
  initialBooked,
  onProgress,
}: {
  tripId: string;
  itinerary: ItineraryDay[];
  initialBooked: string[];
  /** Told how many stops are ticked, at first and after each tick. */
  onProgress?: (booked: number) => void;
}) {
  const t = useTranslations("common.bookAhead");
  const locale = useLocale();
  const stops = useMemo(() => bookAheadStops(itinerary), [itinerary]);
  const [booked, setBooked] = useState(() => new Set(initialBooked));
  const [saveFailed, setSaveFailed] = useState(false);

  const dateLabel = useMemo(() => {
    try {
      return new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
    } catch {
      return new Intl.DateTimeFormat("en", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
    }
  }, [locale]);

  const done = stops.filter((s) => booked.has(s.id)).length;
  useEffect(() => {
    onProgress?.(done);
  }, [done, onProgress]);

  if (stops.length === 0) return null;

  const when = (s: BookAheadStop) =>
    [t("day", { day: s.dayNumber }), s.date ? dateLabel.format(new Date(`${s.date}T00:00:00Z`)) : null, s.startTime ?? null]
      .filter(Boolean)
      .join(" · ");

  const toggle = async (id: string) => {
    const before = booked;
    const next = new Set(booked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setBooked(next);
    setSaveFailed(false);
    try {
      await saveBookedIds(tripId, stops.filter((s) => next.has(s.id)).map((s) => s.id));
    } catch {
      setBooked(before);
      setSaveFailed(true);
    }
  };

  return (
    <section aria-labelledby="book-ahead-title" data-testid="book-ahead" className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="book-ahead-title" className="font-semibold text-[var(--foreground)]">
          <span aria-hidden>🎫 </span>
          {t("title")}
        </h3>
        <p className="text-sm text-[var(--foreground-muted)]">{t("progress", { booked: done, total: stops.length })}</p>
      </div>
      <p className="mt-1 text-sm text-[var(--foreground-muted)]">{t("intro")}</p>
      <ul className="mt-3 divide-y divide-slate-100">
        {stops.map((s) => (
          <li key={s.id} className="flex items-center gap-3 py-2.5">
            <input
              type="checkbox"
              checked={booked.has(s.id)}
              onChange={() => void toggle(s.id)}
              aria-label={t("markBooked", { name: s.name })}
              className="h-5 w-5 shrink-0 rounded border-slate-300 accent-[var(--primary)]"
            />
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-medium ${booked.has(s.id) ? "text-[var(--foreground-muted)] line-through" : "text-[var(--foreground)]"}`}>
                {s.name}
              </p>
              <p className="text-xs text-[var(--foreground-muted)]">{when(s)}</p>
            </div>
            {s.link && (
              <a
                href={s.link}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-sm font-medium text-[var(--foreground)] underline underline-offset-2"
              >
                {t("bookOnline")}
              </a>
            )}
          </li>
        ))}
      </ul>
      {saveFailed && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {t("saveFailed")}
        </p>
      )}
    </section>
  );
}
