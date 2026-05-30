"use client";

import { useTranslations } from "next-intl";
import { Download } from "lucide-react";

interface DownloadIcsButtonProps {
  tripId: string;
  /** Optional className for the wrapper. */
  className?: string;
  /** When true, render the helper subtext under the button (default true). */
  showSubtext?: boolean;
}

/**
 * Per-trip .ics download button.
 *
 * Phase 1 of the calendar-export feature (see
 * docs/specs/calendar-export-smart-notifs.md). Gated by
 * NEXT_PUBLIC_CALENDAR_EXPORT_ENABLED — when the env flag is anything
 * other than the string "true" the component renders nothing.
 *
 * Click flow: navigate to /api/calendar/trip/[id]. The route responds
 * with `Content-Disposition: attachment; filename=...ics` so the
 * browser triggers a download rather than rendering text/calendar
 * inline. We use a plain `<a download>` rather than a JS `fetch` +
 * Blob trick — the latter would force us to bring the entire ICS
 * payload into memory client-side and would block on the route's
 * cache headers being respected.
 *
 * Mounted inside TripDetailClient's action toolbar alongside
 * ShareButton + ExportMenu — descendant of AuthProvider, so calling
 * components further down the tree can use auth hooks safely (the
 * cycle-5 SessionTracker post-mortem only applies to components
 * mounted in app/layout.tsx, which sits above the provider).
 */
export default function DownloadIcsButton({
  tripId,
  className = "",
  showSubtext = true,
}: DownloadIcsButtonProps) {
  const t = useTranslations("common");

  // Hard-gate on the flag. `process.env.NEXT_PUBLIC_*` is inlined at
  // build time on Vercel, so when the env var is unset / "false" this
  // whole subtree is dead-code-eliminated from the client bundle.
  if (process.env.NEXT_PUBLIC_CALENDAR_EXPORT_ENABLED !== "true") {
    return null;
  }

  const href = `/api/calendar/trip/${tripId}`;

  if (!showSubtext) {
    return (
      <a
        href={href}
        className={`flex items-center gap-2 p-2 sm:px-3 sm:py-2 rounded-lg text-sm font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors ${className}`}
        title={t("calendar.downloadIcs")}
        // The route sets Content-Disposition: attachment, so the
        // browser ignores this filename hint — but spelling it out
        // here makes the intent clear and helps when right-click →
        // "Save link as".
        download
      >
        <Download className="w-5 h-5 sm:w-4 sm:h-4" aria-hidden="true" />
        <span className="hidden sm:inline">{t("calendar.downloadIcs")}</span>
      </a>
    );
  }

  return (
    <div className={`flex flex-col items-stretch ${className}`}>
      <a
        href={href}
        className="flex items-center gap-2 p-2 sm:px-3 sm:py-2 rounded-lg text-sm font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
        title={t("calendar.downloadIcs")}
        download
      >
        <Download className="w-5 h-5 sm:w-4 sm:h-4" aria-hidden="true" />
        <span className="hidden sm:inline">{t("calendar.downloadIcs")}</span>
      </a>
      <span className="hidden sm:block text-[10px] text-slate-400 mt-1 text-center leading-tight">
        {t("calendar.downloadIcsSubtitle")}
      </span>
    </div>
  );
}
