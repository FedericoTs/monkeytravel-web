import type { Activity, ActivityProposal } from "@/types";

/** One entry in a day's list outside edit mode: an activity, or a proposal for that day. */
export type TimelineItem<P extends ActivityProposal> =
  | { type: "activity"; data: Activity; index: number }
  | { type: "proposal"; data: P };

/**
 * A day's activities, in order, with the crew's open proposals for that day
 * placed among them: pending, voting, and those approved a moment ago (still
 * shown while the approval animates). A proposal goes before the first entry,
 * activity or proposal, that starts later than it, else at the end. Start
 * times compare as text ("09:30" before "10:00").
 */
export function dayTimeline<P extends ActivityProposal>(
  activities: Activity[],
  proposals: P[],
  dayNumber: number,
  recentlyApproved: ReadonlySet<string>
): TimelineItem<P>[] {
  const timeline: TimelineItem<P>[] = activities.map((activity, index) => ({ type: "activity", data: activity, index }));
  const shown = proposals.filter(
    (p) =>
      p.target_day === dayNumber &&
      (p.status === "pending" || p.status === "voting" || (p.status === "approved" && recentlyApproved.has(p.id)))
  );
  for (const proposal of shown) {
    const time = proposal.activity_data.start_time;
    const later = timeline.findIndex(
      (item) => (item.type === "activity" ? item.data : item.data.activity_data).start_time > time
    );
    timeline.splice(later === -1 ? timeline.length : later, 0, { type: "proposal", data: proposal });
  }
  return timeline;
}
