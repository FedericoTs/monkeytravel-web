"use client";

import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";

// Static pieces of the trip page; the page decides when each shows.

/** Over a day's card while the day regenerates. */
export function RegeneratingDayOverlay({ dayNumber }: { dayNumber: number }) {
  const t = useTranslations("trips");
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center
                    bg-white/70 backdrop-blur-sm rounded-2xl pointer-events-auto"
         aria-live="polite">
      <div className="flex items-center gap-3 px-4 py-2 rounded-full bg-white shadow border border-slate-200">
        <RefreshCw className="w-4 h-4 animate-spin text-[var(--primary-ink)]" />
        <span className="text-sm font-medium text-slate-700">
          {t("detail.regeneratingDay", { number: dayNumber })}
        </span>
      </div>
    </div>
  );
}

/** Above the first day shown while editing: cards can be dragged into order. */
export function ReorderHint() {
  const t = useTranslations("trips");
  return (
    <div className="mb-4 px-1">
      <div className="flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-slate-50 to-slate-100/50 rounded-lg border border-slate-200/60">
        <div className="w-6 h-6 rounded bg-slate-200/80 flex items-center justify-center">
          <svg className="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
          </svg>
        </div>
        <span className="text-sm text-slate-600">
          <span className="font-medium">{t('detail.reorderActivities')}</span>
        </span>
      </div>
    </div>
  );
}

/** In place of the days when the trip has none. */
export function NoItinerary() {
  const t = useTranslations("trips");
  return (
    <div className="text-center py-16 bg-white rounded-2xl border border-slate-200">
      <svg className="w-16 h-16 mx-auto text-slate-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
      </svg>
      <h3 className="text-lg font-medium text-slate-900 mb-2">{t('detail.noItinerary')}</h3>
      <p className="text-slate-600">{t('detail.noItineraryMessage')}</p>
    </div>
  );
}

/** Below the plan while in edit mode. */
export function EditModeNotice() {
  const t = useTranslations("trips");
  return (
    <div className="mt-12 p-5 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl">
      <div className="flex gap-4">
        <div className="flex-shrink-0">
          <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
            <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </div>
        </div>
        <div>
          <h4 className="font-semibold text-blue-900 mb-1">
            {t('detail.editModeActive')}
          </h4>
          <p className="text-sm text-blue-800">
            {t('detail.editModeInstructions')}
          </p>
        </div>
      </div>
    </div>
  );
}

/** Top right once changes are saved, until dismissed. */
export function SaveSuccessToast({ onDismiss }: { onDismiss: () => void }) {
  const t = useTranslations("trips");
  const tA11y = useTranslations("common.a11y");
  return (
    <div className="fixed top-4 right-4 z-50 animate-fade-in-up">
      <div className="flex items-center gap-3 px-4 py-3 bg-green-50 border border-green-200 rounded-lg shadow-lg">
        <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
          <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div>
          <p className="font-medium text-green-800">{t('detail.changesSaved')}</p>
          <p className="text-sm text-green-600">{t('detail.tripUpdated')}</p>
        </div>
        <button
          onClick={() => onDismiss()}
          aria-label={tA11y("dismiss")}
          className="text-green-500 hover:text-green-700 ml-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
