"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";

export type ItineraryView = "cards" | "timeline";

const VIEWS: ItineraryView[] = ["cards", "timeline"];

/**
 * Switches an itinerary between its cards and its timeline. Each button says
 * whether its view is the one shown, and both are in the tab order. Hidden
 * on phones, which show the cards.
 */
export function ViewModeToggle({
  value,
  onChange,
  labels,
  icons,
}: {
  value: ItineraryView;
  onChange: (view: ItineraryView) => void;
  labels: Record<ItineraryView, string>;
  icons?: Record<ItineraryView, ReactNode>;
}) {
  const t = useTranslations("trips");
  return (
    <div className="hidden sm:flex items-center bg-slate-100 rounded-lg p-1" role="group" aria-label={t("detail.viewToggle")}>
      {VIEWS.map((view) => (
        <button
          key={view}
          type="button"
          aria-pressed={value === view}
          onClick={() => onChange(view)}
          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${icons ? "flex items-center gap-1.5 " : ""}${
            value === view ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
          }`}
        >
          {icons?.[view]}
          {labels[view]}
        </button>
      ))}
    </div>
  );
}

/** Shows or hides the trip's map; only its icon on phones. */
export function MapToggle({
  shown,
  onToggle,
  labels,
  icon,
}: {
  shown: boolean;
  onToggle: () => void;
  labels: { show: string; hide: string };
  icon?: ReactNode;
}) {
  const label = shown ? labels.hide : labels.show;
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex items-center gap-2 p-2 sm:px-3 sm:py-2 rounded-lg text-sm font-medium transition-colors ${
        shown ? "bg-[var(--primary)] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
      }`}
      title={label}
    >
      {icon ?? (
        <svg className="w-5 h-5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
          />
        </svg>
      )}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
