import { tripSpanDays } from "@/lib/dates/iso-date";
import type { TripIntent } from "@/lib/posthog/events";

/** The answers a funnel row reads about a plan. */
export interface FunnelAnswers {
  /** Undefined (no place typed yet) leaves it out of the row. */
  destination: string | undefined;
  tripIntent: TripIntent;
  travelStyle: "classic" | "backpacker";
}

/**
 * Where and who: the traits every funnel row about a plan carries
 * (wizard_step_events), and the PostHog events that mirror those rows.
 */
export function funnelTraits({ destination, tripIntent, travelStyle }: FunnelAnswers) {
  return { destination, group_size: tripIntent, backpacker_mode: travelStyle === "backpacker" };
}

/** The plan's length in days for a funnel row; none until both dates are set. */
export function funnelDays(startDate: string, endDate: string): number | undefined {
  return startDate && endDate ? Math.max(1, tripSpanDays(startDate, endDate)) : undefined;
}
