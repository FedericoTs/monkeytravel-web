"use client";

/**
 * Session trips tray — the "sampler fix" (Save Sprint 2026-07-20).
 *
 * Users often generate 2-5 trips in one sitting; each new generation used to
 * silently replace the previous one, so comparing options meant losing them.
 * When the session stack (hooks/useSessionTripStack.ts) holds ≥2 snapshots,
 * this renders a compact horizontal chip row at the top of the result view:
 * one chip per generated trip, current one highlighted, click to flip back.
 *
 * The parent (NewTripWizard) owns visibility rules: the tray only renders
 * while the displayed trip is UNSAVED and the auto-save arm isn't active
 * (swapping under auto-save would UPDATE the persisted row with a different
 * trip's content).
 */

import { useTranslations } from "next-intl";
import type { SessionTripSnapshot } from "@/hooks/useSessionTripStack";

interface SessionTripsTrayProps {
  trips: SessionTripSnapshot[];
  currentId: string | null;
  /** Restore the clicked snapshot into the result view. */
  onRestore: (id: string) => void;
}

export default function SessionTripsTray({
  trips,
  currentId,
  onRestore,
}: SessionTripsTrayProps) {
  const t = useTranslations("trips");
  if (trips.length < 2) return null;

  return (
    <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50/70 p-3">
      <p className="mb-2 px-1 text-xs font-semibold text-amber-800">
        {t("wizard.result.sessionTrayTitle", { count: trips.length })}
      </p>
      <div className="flex gap-2 overflow-x-auto pb-0.5">
        {trips.map((trip) => {
          const isCurrent = trip.id === currentId;
          // Compact chip label: city part only ("Rome, Italy" → "Rome").
          const city =
            (trip.destination.split(",")[0] || trip.destination).trim() ||
            trip.destination;
          return (
            <button
              key={trip.id}
              type="button"
              disabled={isCurrent}
              aria-current={isCurrent ? "true" : undefined}
              onClick={() => {
                if (!isCurrent) onRestore(trip.id);
              }}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                isCurrent
                  ? "border-amber-500 bg-amber-500 text-white shadow-sm"
                  : "border-amber-300 bg-white text-amber-800 hover:border-amber-500 hover:bg-amber-100"
              }`}
            >
              <span className="max-w-[9rem] truncate">{city}</span>
              <span className={isCurrent ? "opacity-90" : "opacity-70"}>
                · {t("wizard.result.days", { count: trip.dayCount })}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
