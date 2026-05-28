"use client";

import {
  getHostelworldSearchUrl,
  isHostelworldAffiliateActive,
} from "@/lib/affiliates/hostelworld";

interface BackpackerHostelCtaProps {
  /** Trip's destination string (e.g. "Barcelona" or "Barcelona, Spain"). */
  destination: string;
  /** Check-in date (YYYY-MM-DD). */
  startDate: string;
  /** Check-out date (YYYY-MM-DD). */
  endDate: string;
  /** Optional class for parent-layout positioning. */
  className?: string;
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
  className,
}: BackpackerHostelCtaProps) {
  const url = getHostelworldSearchUrl({ destination, startDate, endDate });
  const isAffiliate = isHostelworldAffiliateActive();

  return (
    <div className={className}>
      <a
        href={url}
        target="_blank"
        rel={isAffiliate ? "sponsored noopener noreferrer" : "noopener noreferrer"}
        className="group inline-flex w-full sm:w-auto items-center justify-between gap-3 px-4 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 text-white font-semibold shadow-sm hover:shadow-md hover:scale-[1.01] active:scale-[0.99] transition-all"
        data-analytics-event="backpacker_hostel_cta_clicked"
        data-analytics-destination={destination}
      >
        <span className="flex items-center gap-2">
          <span className="text-lg" aria-hidden>🎒</span>
          <span>Find hostels for this trip</span>
        </span>
        <span className="flex items-center gap-1 text-emerald-50 group-hover:text-white text-sm">
          on Hostelworld
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
      </a>
      {isAffiliate && (
        <p className="text-[10px] text-slate-400 mt-1.5 px-1">
          Affiliate link — we may earn a small commission at no extra cost to you.
        </p>
      )}
    </div>
  );
}
