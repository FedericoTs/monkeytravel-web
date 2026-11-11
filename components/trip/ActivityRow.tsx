"use client";

import type { ComponentProps, ReactNode } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { CrewVotePill } from "@/components/trip/CrewVotes";
import TravelConnector from "@/components/trip/TravelConnector";
import { formatDuration } from "@/lib/datetime/duration";

/**
 * One activity in a day's list, editing or viewing: the crew's share-link
 * tally above the card, the card itself (ringed while the assistant has just
 * changed it), a note when it runs into the next activity, and the travel to
 * the next activity below.
 */
export default function ActivityRow({
  crewVotes,
  activityId,
  aiUpdated,
  overlap = null,
  travelTo,
  children,
}: {
  crewVotes: ComponentProps<typeof CrewVotePill>["votes"];
  activityId: string | undefined;
  /** The assistant has just changed this activity. */
  aiUpdated: boolean;
  /**
   * It is still on when the next activity starts, for those who can change
   * it: by how long, the next one's name, and a way to move the later ones,
   * null when the next one is fixed.
   */
  overlap?: { minutes: number; nextName: string; onMakeRoom: (() => void) | null } | null;
  /** The way to the next activity; null on the day's last one. */
  travelTo: ComponentProps<typeof TravelConnector> | null;
  /** The activity's card. */
  children: ReactNode;
}) {
  const t = useTranslations("trips");
  return (
    <div>
      {/* Crew Loop: anon share-link tally */}
      <CrewVotePill votes={crewVotes} activityId={activityId} />
      <div
        className={aiUpdated ? "animate-pulse-once ring-2 ring-[var(--primary)] ring-offset-2 rounded-xl transition-all duration-500" : ""}
      >
        {children}
      </div>
      {overlap && (
        <div role="note" className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
          <span>{t("editActivity.overlap", { name: overlap.nextName, duration: formatDuration(overlap.minutes) })}</span>
          {overlap.onMakeRoom && (
            <button type="button" onClick={overlap.onMakeRoom} className="font-medium underline underline-offset-2 hover:no-underline">
              {t("editActivity.makeRoom")}
            </button>
          )}
        </div>
      )}
      {/* Travel connector to next activity */}
      {travelTo && <TravelConnector segment={travelTo.segment} isLoading={travelTo.isLoading} />}
    </div>
  );
}
