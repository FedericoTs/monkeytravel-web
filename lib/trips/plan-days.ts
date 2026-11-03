import type { GeneratedItinerary, ItineraryDay } from "@/types";

/** What the days' activities are estimated to cost, together. */
function activitiesCost(days: ItineraryDay[]): number {
  return days.reduce((t, d) => t + (d.activities ?? []).reduce((s, a) => s + (a.estimated_cost?.amount || 0), 0), 0);
}

/**
 * The plan with these days. Its total moves by the change in what the
 * activities cost, so the part of it that isn't activities (stays, transport)
 * is kept; it is rounded and never goes below zero.
 */
export function withDays(plan: GeneratedItinerary, days: ItineraryDay[]): GeneratedItinerary {
  const total = plan.trip_summary?.total_estimated_cost || 0;
  return {
    ...plan,
    days,
    trip_summary: {
      ...plan.trip_summary,
      total_estimated_cost: Math.max(0, Math.round(total - activitiesCost(plan.days) + activitiesCost(days))),
    },
  };
}
