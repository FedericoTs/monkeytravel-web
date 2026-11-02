import { trackTripCreated } from "@/lib/analytics";
import { claimTripCreatedEmit } from "@/lib/analytics/tripCreatedDedup";
import { captureFirstTripSaved, type TripIntent } from "@/lib/posthog/events";
import { handleTripCreatedWithReferral } from "@/lib/referral/client";
import { trackWizardEvent } from "@/components/wizard/wizardEvents";

/** A trip the wizard just inserted, and the answers its reports carry. */
export interface SavedTripReport {
  tripId: string;
  durationDays: number;
  destination: string;
  budgetTier: "budget" | "balanced" | "premium";
  tripIntent: TripIntent;
  travelStyle: "classic" | "backpacker";
  anchorCount: number;
  locale: string;
}

/**
 * Reports a trip's first save, whichever way it was saved (the auto-save's
 * insert or the Save button), so both reach the same funnels: GA4's
 * trip_created, the Supabase funnel's `saved`, PostHog's first_trip_saved
 * and the referral credit. Once per trip: a login-return remount can save the
 * same trip again (the row is reused), and the trip-id guard keeps each event
 * to one. `logLabel` names the arm in the logs.
 */
export function reportTripSaved(trip: SavedTripReport, logLabel: string): void {
  if (!claimTripCreatedEmit(trip.tripId)) return;

  trackTripCreated({
    tripId: trip.tripId,
    destination: trip.destination,
    duration: trip.durationDays,
    budgetTier: trip.budgetTier,
    isFromTemplate: false,
  });
  void trackWizardEvent("saved", {
    destination: trip.destination,
    duration_days: trip.durationDays,
    group_size: trip.tripIntent,
    backpacker_mode: trip.travelStyle === "backpacker",
    locale: trip.locale,
  });
  try {
    captureFirstTripSaved({
      trip_id: trip.tripId,
      destination: trip.destination,
      duration_days: trip.durationDays,
      time_to_value_minutes: 0,
      from_template: false,
      is_anchored: trip.anchorCount > 0,
      anchor_count: trip.anchorCount,
    });
  } catch (e) {
    console.error(`[${logLabel}] first_trip_saved error:`, e);
  }
  handleTripCreatedWithReferral(trip.tripId, trip.destination, trip.durationDays, trip.budgetTier, false).catch((err) => {
    console.error(`[${logLabel}] referral/tracking error:`, err);
  });
}
