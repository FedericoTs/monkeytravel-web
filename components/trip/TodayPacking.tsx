"use client";

/**
 * "Packed?" — the packing checklist surfaced in Today. Live Trip Phase 3.4.
 *
 * The packing list has been used by ~0 trips because it lived in a pre-trip
 * screen no one reopened. This puts it where it matters: the day before the
 * trip and on day 1, then it collapses.
 *
 * Packing is PERSONAL ("did I pack my charger"), and the shared surface is
 * dominated by anonymous participants. trip_checklists is per-user and
 * authenticated, so it cannot serve them; the checked state is therefore kept
 * per-device (localStorage), which is the right scope for a personal packing
 * tick and works for the owner and every participant alike. The item list is
 * the trip's own packing suggestions. No table, no write path — deliberately.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

interface TodayPackingProps {
  items: string[];
  tripId: string;
  /** Expanded on the day before + day 1; collapsed once the trip is underway. */
  defaultOpen: boolean;
  className?: string;
}

function storageKey(tripId: string) {
  return `mt_packed_v1:${tripId}`;
}

function readPacked(tripId: string): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey(tripId));
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr.filter((x): x is string => typeof x === "string")) : new Set();
  } catch {
    return new Set();
  }
}

export default function TodayPacking({ items, tripId, defaultOpen, className = "" }: TodayPackingProps) {
  const t = useTranslations("common");
  const uniqueItems = useMemo(() => Array.from(new Set(items.filter((i) => typeof i === "string" && i.trim().length > 0))), [items]);
  const [packed, setPacked] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(defaultOpen);
  const [ready, setReady] = useState(false);

  // Read after mount so SSR and first client render match (no hydration diff).
  useEffect(() => {
    setPacked(readPacked(tripId));
    setReady(true);
  }, [tripId]);

  const toggle = (item: string) => {
    setPacked((prev) => {
      const next = new Set(prev);
      if (next.has(item)) next.delete(item);
      else next.add(item);
      try {
        localStorage.setItem(storageKey(tripId), JSON.stringify([...next]));
      } catch {
        // private mode / blocked storage: the tick still works for this view.
      }
      return next;
    });
  };

  if (uniqueItems.length === 0) return null;
  const count = uniqueItems.filter((i) => packed.has(i)).length;

  return (
    <section data-testid="today-packing" className={`rounded-2xl border border-slate-200 bg-white ${className}`} aria-label={t("today.packing.title")}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <span aria-hidden>🎒</span>
          <span className="text-sm font-bold text-slate-900">{t("today.packing.title")}</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600" data-testid="today-packing-progress">
            {t("today.packing.progress", { done: ready ? count : 0, total: uniqueItems.length })}
          </span>
        </span>
        <span aria-hidden className="text-slate-400">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <ul className="border-t border-slate-100 px-2 py-2">
          {uniqueItems.map((item) => {
            const isPacked = packed.has(item);
            return (
              <li key={item}>
                <button
                  type="button"
                  onClick={() => toggle(item)}
                  data-testid="today-packing-item"
                  aria-pressed={isPacked}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-slate-50"
                >
                  <span
                    className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border ${
                      isPacked ? "border-[var(--primary)] bg-[var(--primary)] text-white" : "border-slate-300 bg-white"
                    }`}
                    aria-hidden
                  >
                    {isPacked ? "✓" : ""}
                  </span>
                  <span className={`text-sm ${isPacked ? "text-slate-400 line-through" : "text-slate-700"}`}>{item}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
