"use client";

import { useTranslations } from "next-intl";

/**
 * Shown when a save was refused because the itinerary changed elsewhere after
 * this page loaded (a trip mate, or this person in another tab). Until
 * 2026-09-24 the later save simply overwrote the earlier one, and nobody knew.
 *
 * Two choices, both explicit: take the newer version (drops this tab's
 * unsaved changes) or keep this tab's version (saved on top of the newer
 * one). "Keep mine" only appears when there is something of mine to keep.
 */
interface ItineraryConflictBannerProps {
  canKeepMine: boolean;
  onLoadLatest: () => void;
  onKeepMine: () => void;
  busy?: boolean;
}

export default function ItineraryConflictBanner({
  canKeepMine,
  onLoadLatest,
  onKeepMine,
  busy = false,
}: ItineraryConflictBannerProps) {
  const t = useTranslations("trips");

  return (
    <div
      role="alert"
      data-testid="itinerary-conflict"
      className="fixed top-4 inset-x-4 z-[60] mx-auto max-w-xl rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-lg"
    >
      <div className="flex items-start gap-3">
        <svg className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-700" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M5.07 19h13.86a2 2 0 001.71-3l-6.93-12a2 2 0 00-3.42 0l-6.93 12a2 2 0 001.71 3z" />
        </svg>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-900">{t("detail.conflictTitle")}</p>
          <p className="mt-1 text-sm text-slate-700">{t("detail.conflictBody")}</p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            <div className="flex-1">
              <button
                type="button"
                data-testid="conflict-load-latest"
                onClick={onLoadLatest}
                disabled={busy}
                className="inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
              >
                {t("detail.conflictLoadLatest")}
              </button>
              <p className="mt-1 text-xs text-slate-600">{t("detail.conflictLoadLatestHint")}</p>
            </div>
            {canKeepMine && (
              <div className="flex-1">
                <button
                  type="button"
                  data-testid="conflict-keep-mine"
                  onClick={onKeepMine}
                  disabled={busy}
                  className="inline-flex min-h-[44px] w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-50 disabled:opacity-50"
                >
                  {t("detail.conflictKeepMine")}
                </button>
                <p className="mt-1 text-xs text-slate-600">{t("detail.conflictKeepMineHint")}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
