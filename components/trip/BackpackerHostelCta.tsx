"use client";

import { useTranslations } from "next-intl";
import {
  getHostelworldSearchUrl,
  isHostelworldAffiliateActive,
} from "@/lib/affiliates/hostelworld";
import { openExternal } from "@/lib/native/external-link";

interface BackpackerHostelCtaProps {
  /** Trip's destination string (e.g. "Barcelona" or "Barcelona, Spain"). */
  destination: string;
  /** Check-in date (YYYY-MM-DD). */
  startDate: string;
  /** Check-out date (YYYY-MM-DD). */
  endDate: string;
  /** Optional trip id — included in the click log when present. */
  tripId?: string;
  /** Optional class for parent-layout positioning. */
  className?: string;
}

/**
 * Fire-and-forget click tracker. Posts to /api/affiliates/hostelworld/click
 * which writes one row in public.hostelworld_clicks (shipped 2026-05-28
 * as Tier 1.3 of MIGRATION_PLAN.md). Used to power the headline metric
 * for the Hostelworld partnership conversation:
 *   "We drove N hostel searches to you in the last 30 days."
 *
 * keepalive=true: the click navigates the browser away (target=_blank in
 * a new tab — usually fine — but on some browsers/extensions it might
 * still cancel the in-flight fetch). keepalive lets the request survive.
 */
function logClick(payload: {
  tripId?: string;
  destination: string;
  startDate: string;
  endDate: string;
}) {
  try {
    fetch("/api/affiliates/hostelworld/click", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        ...payload,
        sourcePath: typeof window !== "undefined" ? window.location.pathname : null,
      }),
    }).catch(() => {
      // Click logging is best-effort. Never bubble to user.
    });
  } catch {
    /* noop */
  }
}

/**
 * "Find hostels for this trip" CTA. Renders ONLY on trips with
 * trip_meta.travel_style === "backpacker" (the parent gates that — we
 * keep this component dumb so it's reusable).
 *
 * Strategic context (shipped 2026-05-28): part of the Hostelworld
 * partnership wedge. The button is live in production immediately,
 * even before any formal Awin affiliate ID is configured, so we can
 * start measuring CTR. Once HOSTELWORLD_AWIN_AFFILIATE_ID is set in
 * Vercel env, the same button starts earning commission with zero
 * code change. The displayed badge below the button switches based
 * on isHostelworldAffiliateActive() to keep the affiliate disclosure
 * accurate.
 */
export default function BackpackerHostelCta({
  destination,
  startDate,
  endDate,
  tripId,
  className,
}: BackpackerHostelCtaProps) {
  // i18n: three hardcoded English strings + the legally-important affiliate
  // disclosure. Mirrors PublishToggle pattern (commit 7db5fd8).
  const t = useTranslations("common.backpacker.hostelCta");
  const url = getHostelworldSearchUrl({ destination, startDate, endDate });
  const isAffiliate = isHostelworldAffiliateActive();

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => {
          logClick({ tripId, destination, startDate, endDate });
          void openExternal(url);
        }}
        className="group inline-flex w-full sm:w-auto items-center justify-between gap-3 px-4 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 text-white font-semibold shadow-sm hover:shadow-md hover:scale-[1.01] active:scale-[0.99] transition-all"
        data-analytics-event="backpacker_hostel_cta_clicked"
        data-analytics-destination={destination}
        data-affiliate={isAffiliate ? "sponsored" : undefined}
      >
        <span className="flex items-center gap-2">
          <span className="text-lg" aria-hidden>🎒</span>
          <span>{t("findHostels")}</span>
        </span>
        <span className="flex items-center gap-1 text-emerald-50 group-hover:text-white text-sm">
          {t("onHostelworld")}
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M14 5l7 7m0 0l-7 7m7-7H3"
            />
          </svg>
        </span>
      </button>
      {isAffiliate && (
        <p className="text-[10px] text-slate-400 mt-1.5 px-1">
          {t("affiliateDisclosure")}
        </p>
      )}
    </div>
  );
}
