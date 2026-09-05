"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { buildPendingClaim, shareAnonymousTrip, type PendingClaim } from "@/lib/trips/anonymous-claim-client";
import { crewShareUrl, shareTokenFromUrl, totalVotes } from "@/lib/trips/crew-share";
import {
  captureAnonShareClicked,
  captureAnonShareCreated,
  captureAnonShareFailed,
  captureAnonShareCopied,
  captureAnonShareKeepClicked,
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
    /** Language the itinerary was generated in — stored as trip_meta.locale (Phase 1.3). */
    locale?: string;
  };
  /** Fired with the share URL once minted, so the parent can log conversion. */
  onShared?: (pending: PendingClaim) => void;
  /** "Keep this trip, free": opens the sign-up path. The row renders only when provided. */
  onKeep?: () => void;
  /**
   * "crew" reframes the same account-free link as a request for votes.
   *
   * 531 wizard sessions a month answer "with friends" at step 1 and 477 of
   * them generate a trip — yet across 449 live trips there are 3 collaborator
   * rows, 6 invites ever, and zero authenticated votes. The only multiplayer
   * thing anyone uses is the one needing no account: 51 anonymous votes. So
   * the crew ask rides the anonymous share rather than the invite system, and
   * the link carries ?vote=1 so the landing page leads with voting.
   */
  mode?: "share" | "crew";
  /**
   * A link already minted in THIS session. More than one of these buttons can
   * be on screen at once (the header action and the assistant bridge), and
   * each mint creates a real ownerless trip row while the browser keeps only
   * the LAST claim token — so a second mint would strand the first trip and
   * inflate the anonymous-share counts. Given this, the button skips straight
   * to its ready state and shows the same link.
   */
  existingShareUrl?: string | null;
  className?: string;
}

export default function AnonymousShareButton({ trip, onShared, onKeep, existingShareUrl, mode = "share", className = "" }: Props) {
  const crew = mode === "crew";
  const t = useTranslations("trips");
  const [state, setState] = useState<"idle" | "creating" | "ready" | "error">("idle");
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Votes cast on the link so far. The crew loop only closes if the planner
  // has a reason to come back: they send the link, friends vote without an
  // account, and this is what they see on return.
  const [voteCount, setVoteCount] = useState(0);

  // Adopt a link another instance already minted — DERIVED, not synced into
  // state: an effect that mirrors a prop into state is a second source of
  // truth that renders one frame stale, and here it also trips the
  // set-state-in-effect rule.
  const rawUrl = shareUrl ?? existingShareUrl ?? null;
  // A crew link carries ?vote=1, which tells /shared to lead with the vote
  // prompt. The token is untouched, so the link opens the same trip either way.
  const effectiveUrl = crewShareUrl(rawUrl, mode);
  const effectiveState = state === "creating" ? "creating" : effectiveUrl ? "ready" : state;

  const shareToken = shareTokenFromUrl(rawUrl);

  // Read the tally on mount and again whenever the planner comes back.
  // Coming back IS the signal: they leave for a messaging app to send the
  // link and return here, which is exactly when new votes are worth showing.
  // No polling timer, so nothing to leak and nothing to throttle.
  //
  // Both events, because neither covers the main case alone: window "focus"
  // misses a mobile browser resuming from the background (notably iOS
  // Safari), and that — send it in WhatsApp, come back — is precisely how
  // this link gets shared. "visibilitychange" is the reliable half there.
  useEffect(() => {
    if (!crew || !shareToken) return;
    let cancelled = false;

    const read = async () => {
      try {
        const res = await fetch(`/api/shared/${shareToken}/votes`, { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const json = await res.json();
        if (cancelled) return;
        // Read both shapes: this codebase wraps some routes in `data` and
        // some not, and guessing wrong would silently show zero forever.
        setVoteCount(totalVotes(json?.data?.tallies ?? json?.tallies));
      } catch {
        /* the count is a bonus, never an error the planner has to see */
      }
    };

    const onReturn = () => {
      // Both handlers can fire for one switch; skip the duplicate rather than
      // sending two identical reads.
      if (document.visibilityState === "hidden") return;
      void read();
    };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    void read();

    return () => {
      cancelled = true;
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [crew, shareToken]);

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
        intent: mode,
        title: trip.title,
        description: trip.description,
        destination: trip.destination,
        startDate: trip.startDate,
        endDate: trip.endDate,
        itinerary: trip.itinerary,
        coverImageUrl: trip.coverImageUrl ?? null,
        locale: trip.locale,
      });
      setShareUrl(result.shareUrl);
      setState("ready");
      void captureAnonShareCreated({ ...analyticsBase, trip_id: result.tripId });
      onShared?.(buildPendingClaim(result, trip));
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

  if (effectiveState === "ready" && effectiveUrl) {
    return (
      <div className={`flex flex-col gap-2 ${className}`}>
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={effectiveUrl}
            onFocus={(e) => e.currentTarget.select()}
            aria-label={crew ? t("wizard.result.shareCrewCta") : t("wizard.result.shareAnonCta")}
            className="flex-1 min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
          />
          <button
            type="button"
            onClick={() => copy(effectiveUrl, "manual")}
            className="shrink-0 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
          >
            {copied ? t("wizard.result.shareAnonCopied") : t("wizard.result.shareAnonCopy")}
          </button>
        </div>
        <p className="text-xs text-slate-500">
          {crew ? t("wizard.result.shareCrewHint") : t("wizard.result.shareAnonHint")}
        </p>
        {crew && voteCount > 0 && (
          <a
            href={effectiveUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--primary-ink)] hover:underline"
          >
            <span aria-hidden>🗳️</span>
            {t("wizard.result.shareCrewVotes", { count: voteCount })}
          </a>
        )}
        {/* The ask that was missing: 56 signed-out shares in 30 days, 0 ever
            kept (2026-09-02). Same sign-up path as the Save button, which
            converts 46% of the signed-out planners who reach it. */}
        {onKeep && (
          <div
            className="mt-1 flex flex-col gap-2 rounded-xl border border-[var(--primary)]/20 bg-[var(--background-warm)] px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
            data-anon-share-keep
          >
            <p className="text-sm text-slate-700">{t("wizard.result.shareAnonKeepPrompt")}</p>
            <button
              type="button"
              onClick={() => {
                void captureAnonShareKeepClicked(analyticsBase);
                onKeep();
              }}
              className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-xl bg-[var(--primary)] px-4 text-sm font-semibold text-white transition-colors hover:bg-[var(--primary)]/90"
            >
              {t("wizard.result.shareAnonKeepCta")}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <button
        type="button"
        onClick={handleShare}
        disabled={effectiveState === "creating"}
        className="flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-6 py-2.5 font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
      >
        {effectiveState === "creating" ? (
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
            {crew ? t("wizard.result.shareCrewCta") : t("wizard.result.shareAnonCta")}
          </>
        )}
      </button>
      {effectiveState === "error" && (
        <p role="alert" className="text-xs text-rose-600">
          {t("wizard.result.shareAnonError")}
        </p>
      )}
    </div>
  );
}
