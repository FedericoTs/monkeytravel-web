import type { TripIntent } from "@/lib/posthog/events";
import type { GeneratedItinerary } from "@/types";

/**
 * What the no-account share button is given for a generated plan; the result
 * view's header bar, phone bar and assistant offer the same one. A group trip
 * shares as the crew's vote ask, and a link already made for this plan is
 * reused.
 */
export function anonymousShare({
  itinerary,
  tripTitle,
  destination,
  startDate,
  endDate,
  locale,
  tripIntent,
  sessionShareUrl,
}: {
  itinerary: GeneratedItinerary;
  tripTitle: string;
  destination: string;
  startDate: string;
  endDate: string;
  locale: string;
  tripIntent: TripIntent;
  sessionShareUrl: string | null;
}) {
  return {
    trip: {
      title: tripTitle,
      description: itinerary.destination.description,
      destination,
      startDate,
      endDate,
      itinerary: itinerary.days,
      locale: itinerary.language ?? locale,
    },
    mode: tripIntent === "group" ? ("crew" as const) : ("share" as const),
    existingShareUrl: sessionShareUrl,
  };
}
