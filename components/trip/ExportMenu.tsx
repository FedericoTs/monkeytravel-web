"use client";

import { useState, useRef, useEffect } from "react";
import type { ItineraryDay, TripMeta } from "@/types";
// Types only (zero bundle impact) - functions loaded dynamically on demand
import type { PremiumTripForExport } from "@/lib/export/pdf";
import { downloadICS } from "@/lib/export/calendar";
import { useTranslations } from "next-intl";
import { capture } from "@/lib/posthog/events";

// Lazy loaders for PDF export (~75KB saved from initial bundle)
const lazyLoadPdfExport = () => import("@/lib/export/pdf");
const lazyLoadPremiumPdfExport = () => import("@/lib/export/pdf/index");

interface ExportMenuProps {
  trip: {
    title: string;
    description?: string;
    startDate: string;
    endDate: string;
    budget?: { total: number; currency: string } | null;
    itinerary: ItineraryDay[];
  };
  // Optional props for premium PDF
  destination?: string;
  meta?: TripMeta;
  coverImageUrl?: string;
  galleryPhotos?: { url: string; thumbnailUrl: string }[];
  /**
   * Where this menu lives — feeds the trip_exported / trip_export_failed
   * PostHog events so we can segment anon-result exports (peak-intent,
   * pre-save) from saved trip-detail and shared-view exports.
   */
  surface?: string;
}

export default function ExportMenu({ trip, destination, meta, coverImageUrl, galleryPhotos, surface = "trip_detail" }: ExportMenuProps) {
  const t = useTranslations('common.export');
  const [isOpen, setIsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState<"pdf" | "premium-pdf" | "ics" | null>(null);
  const [exportProgress, setExportProgress] = useState<{ step: string; progress: number } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Surface an export failure to the user + analytics + Sentry, instead of
  // the previous swallow-with-console.error (the spinner just stopped and
  // nothing downloaded — a silent dead end). Lazy-imports Sentry so a
  // missing/failed Sentry never breaks the menu (mirrors ExpenseLedger).
  const reportExportFailure = (format: "pdf" | "premium-pdf" | "ical", error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[ExportMenu] ${format} export failed`, message);
    setExportError(t("exportFailed"));
    capture("trip_export_failed", { format, surface });
    import("@sentry/nextjs")
      .then((Sentry) => {
        Sentry.captureException?.(error instanceof Error ? error : new Error(message), {
          tags: { source: "ExportMenu", subsystem: "export" },
          level: "warning",
          extra: { format, surface },
        });
      })
      .catch(() => {
        /* Sentry not available — console.error above is the fallback */
      });
  };

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const handleExportPDF = async () => {
    setIsExporting("pdf");
    setExportError(null);
    try {
      // Dynamically load PDF export on first use (~75KB)
      const { downloadPDF } = await lazyLoadPdfExport();
      await downloadPDF(trip);
      capture("trip_exported", { format: "pdf", surface });
    } catch (error) {
      reportExportFailure("pdf", error);
    } finally {
      setIsExporting(null);
      setIsOpen(false);
    }
  };

  const handleExportPremiumPDF = async () => {
    setIsExporting("premium-pdf");
    setExportProgress({ step: "Starting...", progress: 0 });

    try {
      // Dynamically load premium PDF export on first use
      const { downloadPremiumPDF } = await lazyLoadPremiumPdfExport();

      // Build the premium trip data
      const premiumTrip: PremiumTripForExport = {
        title: trip.title,
        description: trip.description,
        destination: destination || trip.title.replace(/ Trip$/, ""),
        startDate: trip.startDate,
        endDate: trip.endDate,
        budget: trip.budget,
        itinerary: trip.itinerary,
        meta: meta,
        coverImageUrl: coverImageUrl,
        galleryPhotos: galleryPhotos,
      };

      await downloadPremiumPDF(premiumTrip, (step, progress) => {
        setExportProgress({ step, progress });
      });
      capture("trip_exported", { format: "premium-pdf", surface });
    } catch (error) {
      reportExportFailure("premium-pdf", error);
    } finally {
      setIsExporting(null);
      setExportProgress(null);
      setIsOpen(false);
    }
  };

  const handleExportICS = () => {
    setIsExporting("ics");
    setExportError(null);
    try {
      downloadICS(trip);
      capture("trip_exported", { format: "ical", surface });
    } catch (error) {
      reportExportFailure("ical", error);
    } finally {
      setIsExporting(null);
      setIsOpen(false);
    }
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => {
          const next = !isOpen;
          setIsOpen(next);
          // Reopening dismisses a stale error so the retry starts clean.
          if (next) setExportError(null);
        }}
        aria-label={t('title')}
        className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        <span className="hidden sm:inline">{t('title')}</span>
        <svg className={`w-3 h-3 transition-transform ${isOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-64 bg-white border border-slate-200 rounded-xl shadow-lg py-2 z-20">
          <div className="px-3 py-2 border-b border-slate-100">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              {t('download')}
            </span>
          </div>

          {/* Premium PDF - Hidden for now, code preserved for future improvements */}

          {/* PDF */}
          <button
            onClick={handleExportPDF}
            disabled={isExporting === "pdf"}
            className="w-full flex items-center gap-3 px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            {isExporting === "pdf" ? (
              <svg className="w-5 h-5 animate-spin text-slate-400" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : (
              <svg className="w-5 h-5 text-slate-400" fill="currentColor" viewBox="0 0 24 24">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" />
                <path d="M14 2v6h6M9 13h6M9 17h6" stroke="white" strokeWidth="1.5" fill="none" />
              </svg>
            )}
            <div>
              <div className="font-medium">{t('pdfItinerary')}</div>
              <div className="text-xs text-slate-500">{t('pdfDescription')}</div>
            </div>
          </button>

          <button
            onClick={handleExportICS}
            disabled={isExporting === "ics"}
            className="w-full flex items-center gap-3 px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            {isExporting === "ics" ? (
              <svg className="w-5 h-5 animate-spin text-slate-400" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : (
              <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            )}
            <div>
              <div className="font-medium">{t('calendarFile')}</div>
              <div className="text-xs text-slate-500">{t('calendarDescription')}</div>
            </div>
          </button>

          {/*
            "Add to Calendar" section removed (follow-up to #235):
            both Apple and Google Calendar entries pointed at dead
            backends. Apple Calendar's webcal:// URL was a 404 (fixed
            in #235); Google Calendar's render-link entry depended on
            the OAuth callback at app/api/calendar/google/callback,
            which was deleted in cleanup #224. The in-dropdown
            "Calendar File (.ics)" download already works in Apple
            Calendar, Google Calendar, and Outlook — users just
            double-click / import the file. If we ever wire a real
            calendar-subscription feed we can restore the section.
          */}
        </div>
      )}

      {/* Export error — rendered outside the dropdown (which closes on the
          failing action's `finally`) so the user isn't left with a stopped
          spinner and no explanation. */}
      {exportError && (
        <div
          role="alert"
          className="absolute right-0 mt-2 w-64 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 shadow-lg z-20"
        >
          {exportError}
        </div>
      )}
    </div>
  );
}
