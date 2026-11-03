"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useStoredFlag } from "@/hooks/useStoredFlag";
import { fetchShareStatus } from "@/lib/trips/share-status";

/** Votes friends cast on the trip through its share link, with no account. */
export interface CrewVotes {
  total: number;
  voters: string[];
  byActivity: Record<string, { up: number; down: number }>;
}

/**
 * For the trip's owner: whether the trip is shared, and the crew's votes when
 * it is. Both stay null while loading, for anyone else, and when a read fails:
 * the page works without them.
 */
export function useCrewVotes(tripId: string, isOwner: boolean): { sharingEnabled: boolean | null; votes: CrewVotes | null } {
  const [sharingEnabled, setSharingEnabled] = useState<boolean | null>(null);
  const [votes, setVotes] = useState<CrewVotes | null>(null);

  useEffect(() => {
    if (!isOwner) return;
    let cancelled = false;
    (async () => {
      try {
        const share = await fetchShareStatus(tripId);
        if (!share || cancelled) return;
        setSharingEnabled(!!share.isShared);
        if (!share.isShared) return;
        const res = await fetch(`/api/trips/${tripId}/crew-votes`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) setVotes(data);
      } catch (err) {
        console.warn("[crew-votes] fetch failed (non-fatal):", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOwner, tripId]);

  return { sharingEnabled, votes };
}

/** An activity's crew votes ("👍2 👎1"), when it has any. */
export function CrewVotePill({ votes, activityId }: { votes: CrewVotes | null; activityId: string | undefined }) {
  const tally = activityId ? votes?.byActivity[activityId] : undefined;
  if (!tally || (tally.up === 0 && tally.down === 0)) return null;
  return (
    <div className="flex justify-end mb-1">
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-violet-50 border border-violet-200 text-[11px] font-medium text-violet-700">
        <span>👍{tally.up}</span>
        <span>👎{tally.down}</span>
      </span>
    </div>
  );
}

/** How many votes the crew cast and who voted, with a way to ask for more. */
export function CrewVotesSummary({ votes, onShare }: { votes: CrewVotes; onShare: () => void }) {
  const t = useTranslations("trips");
  return (
    <div className="mb-6 p-4 bg-gradient-to-r from-violet-50 to-blue-50 border border-violet-200 rounded-xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">
            {t("detail.crewVotesSummary", { count: votes.total })}
          </p>
          {votes.voters.length > 0 && (
            <p className="text-xs text-slate-600 mt-0.5">
              {t("detail.crewVotesVoters", { names: votes.voters.join(", ") })}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onShare}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90 transition-colors"
        >
          {t("detail.crewVotesShare")}
        </button>
      </div>
    </div>
  );
}

/**
 * Asks an owner who never shared the trip to send it to the people coming.
 * Dismissed per trip in this browser, and hidden until that is known.
 */
export function CrewShareNudge({ tripId, onShare }: { tripId: string; onShare: () => void }) {
  const t = useTranslations("trips");
  const [dismissed, dismiss] = useStoredFlag(`crewCtaDismissed:${tripId}`, "1");
  if (dismissed !== false) return null;
  return (
    <div className="relative mb-6 p-4 bg-gradient-to-r from-violet-50 to-blue-50 border border-violet-200 rounded-xl">
      <button
        type="button"
        onClick={dismiss}
        aria-label={t("detail.crewCtaDismiss")}
        title={t("detail.crewCtaDismiss")}
        className="absolute top-3 right-3 text-slate-500 hover:text-slate-600 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
      <div className="flex flex-wrap items-center justify-between gap-3 pr-8">
        <p className="text-sm font-medium text-slate-900">{t("detail.crewCtaText")}</p>
        <button
          type="button"
          onClick={onShare}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90 transition-colors"
        >
          {t("detail.crewCtaButton")}
        </button>
      </div>
    </div>
  );
}
