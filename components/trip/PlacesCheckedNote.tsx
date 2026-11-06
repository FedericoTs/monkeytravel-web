"use client";

import { useLocale, useTranslations } from "next-intl";
import type { PlacesToEatNote } from "@/lib/places/kept-trip";

/** Says a trip's places to eat were looked up on Google Maps, when, and what that changed. */
export function PlacesCheckedNote({ note, className = "" }: { note: PlacesToEatNote | null; className?: string }) {
  const t = useTranslations("trips");
  const locale = useLocale();
  if (!note) return null;
  // In UTC, so the server's copy of the page and the browser's say the same day.
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(note.checkedAt));
  return (
    <p className={`flex items-start gap-1.5 text-xs text-slate-600 ${className}`}>
      <svg className="mt-px h-3.5 w-3.5 shrink-0 text-[var(--secondary-ink)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
      <span>
        {t("placesChecked.checked", { count: note.checked, date })}
        {note.changed > 0 ? ` ${t("placesChecked.changed", { count: note.changed })}` : ""}
      </span>
    </p>
  );
}
