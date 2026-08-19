"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { shareAnonymousTrip } from "@/lib/trips/anonymous-claim-client";
import {
  captureAnonShareClicked,
  captureAnonShareCreated,
  captureAnonShareFailed,
  captureAnonShareCopied,
} from "@/lib/posthog/events";

/**
 * Share control for a trip generated while signed OUT.
 *
 * This is hop one of the crew loop, which previously did not exist: an
 * anonymous planner could generate an itinerary but had no way to send it to
 * anybody, because minting a share link required an authenticated owner. Only
 * 17% of all trips ever created had been shared.
 *
 * Self-contained on purpose. The wizard's result view carries the auto-save
 * state machine, the mobile sticky bar and several conversion experiments;
 * dropping a closed component beside the save CTA keeps this feature's blast
 * radius off that logic entirely.
 *
 * The copy deliberately pairs the capability with its limit — anyone with the
 * link can look and vote, and keeping or editing the trip needs an account.
 * That is the signup pull, and hiding it would just produce confused users who
 * think they already saved something.
 */

interface Props {
  trip: {
    title: string;
    description?: string;
    destination: string;
    startDate: string;
    endDate: string;
    itinerary: unknown[];
    coverImageUrl?: string | null;
  };
  /** Fired with the share URL once minted, so the parent can log conversion. */
  onShared?: (shareUrl: string) => void;
  className?: string;
}

export default function AnonymousShareButton({ trip, onShared, className = "" }: Props) {
  const t = useTranslations("trips");
  const [state, setState] = useState<"idle" | "creating" | "ready" | "error">("idle");
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Shared shape for every event in this loop, so click / mint / send are
  // directly comparable in a funnel without re-deriving properties per call.
  const analyticsBase = {
    destination: trip.destination,
    duration_days: Array.isArray(trip.itinerary) ? trip.itinerary.length : 0,
  };

  async function handleShare() {
    if (state === "creating") return; // re-entry guard: minting creates a row
    setState("creating");
    // Captured after the guard so a double-press cannot inflate the
    // denominator the mint rate is measured against.
    void captureAnonShareClicked(analyticsBase);
    try {
      const result = await shareAnonymousTrip({
        title: trip.title,
        description: trip.description,
        destination: trip.destination,
        startDate: trip.startDate,
        endDate: trip.endDate,
        itinerary: trip.itinerary,
        coverImageUrl: trip.coverImageUrl ?? null,
      });
      setShareUrl(result.shareUrl);
      setState("ready");
      void captureAnonShareCreated({ ...analyticsBase, trip_id: result.tripId });
      onShared?.(result.shareUrl);
      void copy(result.shareUrl, "auto");
    } catch (err) {
      setState("error");
      void captureAnonShareFailed({
        ...analyticsBase,
        reason: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  async function copy(url: string, trigger: "auto" | "manual") {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      // Only the successful write counts as distribution — a blocked
      // clipboard means the link never left the page.
      void captureAnonShareCopied({ ...analyticsBase, trigger });
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      /* clipboard blocked — the input below is selectable as the fallback */
    }
  }

  if (state === "ready" && shareUrl) {
    return (
      <div className={`flex flex-col gap-2 ${className}`}>
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={shareUrl}
            onFocus={(e) => e.currentTarget.select()}
            aria-label={t("wizard.result.shareAnonCta")}
            className="flex-1 min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
          />
          <button
            type="button"
            onClick={() => copy(shareUrl, "manual")}
            className="shrink-0 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
          >
            {copied ? t("wizard.result.shareAnonCopied") : t("wizard.result.shareAnonCopy")}
          </button>
        </div>
        <p className="text-xs text-slate-500">{t("wizard.result.shareAnonHint")}</p>
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <button
        type="button"
        onClick={handleShare}
        disabled={state === "creating"}
        className="flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-6 py-2.5 font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
      >
        {state === "creating" ? (
          <>
            <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            {t("wizard.result.shareAnonCreating")}
          </>
        ) : (
          <>
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8.684 13.342a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
              />
            </svg>
            {t("wizard.result.shareAnonCta")}
          </>
        )}
      </button>
      {state === "error" && (
        <p role="alert" className="text-xs text-rose-600">
          {t("wizard.result.shareAnonError")}
        </p>
      )}
    </div>
  );
}
