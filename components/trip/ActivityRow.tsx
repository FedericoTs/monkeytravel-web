"use client";

import type { ComponentProps, ReactNode } from "react";
import { CrewVotePill } from "@/components/trip/CrewVotes";
import TravelConnector from "@/components/trip/TravelConnector";

/**
 * One activity in a day's list, editing or viewing: the crew's share-link
 * tally above the card, the card itself (ringed while the assistant has just
 * changed it), and the travel to the next activity below.
 */
export default function ActivityRow({
  crewVotes,
  activityId,
  aiUpdated,
  travelTo,
  children,
}: {
  crewVotes: ComponentProps<typeof CrewVotePill>["votes"];
  activityId: string | undefined;
  /** The assistant has just changed this activity. */
  aiUpdated: boolean;
  /** The way to the next activity; null on the day's last one. */
  travelTo: ComponentProps<typeof TravelConnector> | null;
  /** The activity's card. */
  children: ReactNode;
}) {
  return (
    <div>
      {/* Crew Loop: anon share-link tally */}
      <CrewVotePill votes={crewVotes} activityId={activityId} />
      <div
        className={aiUpdated ? "animate-pulse-once ring-2 ring-[var(--primary)] ring-offset-2 rounded-xl transition-all duration-500" : ""}
      >
        {children}
      </div>
      {/* Travel connector to next activity */}
      {travelTo && <TravelConnector segment={travelTo.segment} isLoading={travelTo.isLoading} />}
    </div>
  );
}
