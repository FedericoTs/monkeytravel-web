import type { Activity } from "@/types";

/**
 * The id of an activity's element on the page (its card, or its row in the
 * wizard's timeline), which the wizard's map pin "View details" scrolls to.
 * An activity without an id (a plan not saved yet) is addressed by its name.
 */
export function activityDomId(activity: Pick<Activity, "id" | "name">): string {
  if (activity.id) return `activity-${activity.id}`;
  return `activity-${(activity.name || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60)}`;
}
