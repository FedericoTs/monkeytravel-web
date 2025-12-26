import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { v4 as uuidv4 } from "uuid";
import type { ItineraryDay, Activity } from "@/types";
import { generateActivityId } from "@/lib/utils/activity-id";
import { completeReferralIfEligible } from "@/lib/referral/completion";
import { captureServerEvent } from "@/lib/posthog/server";

/**
 * POST /api/trips/duplicate - Duplicate a shared trip to user's account
 *
 * This endpoint allows authenticated users to copy a shared trip to their own account.
 * The duplicated trip will be private and fully editable by the new owner.
 *
 * Body:
 * - shareToken: string (required) - The share token of the trip to duplicate
 * - startDate: string (optional) - Custom start date for the trip (ISO format)
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return errors.unauthorized("Please sign in to save this trip");
    }

    // Get share token and optional start date from request body
    const body = await request.json();
    const { shareToken, startDate } = body;

    if (!shareToken) {
      return errors.badRequest("Share token is required");
    }

    // Fetch the source trip by share token
    const { data: sourceTrip, error: fetchError } = await supabase
      .from("trips")
      .select("*")
      .eq("share_token", shareToken)
      .single();

    if (fetchError || !sourceTrip) {
      return errors.notFound("Shared trip not found");
    }

    // Note: We allow users to duplicate the same trip multiple times
    // Each duplication creates a completely independent copy

    // Create a new trip ID
    const newTripId = uuidv4();

    // Calculate dates - use custom start date if provided, otherwise use original
    let tripStartDate = sourceTrip.start_date;
    let tripEndDate = sourceTrip.end_date;
    let adjustedItinerary = sourceTrip.itinerary;

    if (startDate) {
      // Calculate duration from original trip
      const originalStart = new Date(sourceTrip.start_date);
      const originalEnd = new Date(sourceTrip.end_date);
      const durationDays = Math.ceil(
        (originalEnd.getTime() - originalStart.getTime()) / (1000 * 60 * 60 * 24)
      );

      // Set new dates
      const newStart = new Date(startDate);
      const newEnd = new Date(newStart);
      newEnd.setDate(newEnd.getDate() + durationDays);

      tripStartDate = newStart.toISOString().split("T")[0];
      tripEndDate = newEnd.toISOString().split("T")[0];

      // Adjust itinerary dates and regenerate activity IDs
      if (sourceTrip.itinerary && Array.isArray(sourceTrip.itinerary)) {
        adjustedItinerary = (sourceTrip.itinerary as ItineraryDay[]).map(
          (day: ItineraryDay, index: number) => {
            const dayDate = new Date(newStart);
            dayDate.setDate(dayDate.getDate() + index);

            return {
              ...day,
              date: dayDate.toISOString().split("T")[0],
              activities: day.activities.map((activity: Activity) => ({
                ...activity,
                // Generate new unique IDs for the copied activities
                id: generateActivityId(),
              })),
            };
          }
        );
      }
    }

    // Prepare the duplicated trip data
    // Only include columns that exist in the trips table
    // Note: 'destination' is NOT a column - it's stored in trip_meta or derived from title
    const duplicatedTrip: Record<string, unknown> = {
      id: newTripId,
      user_id: user.id,
      title: sourceTrip.title,
      description: sourceTrip.description,
      start_date: tripStartDate,
      end_date: tripEndDate,
      status: "planning", // New trips start as planning
      budget: sourceTrip.budget,
      tags: sourceTrip.tags,
      itinerary: adjustedItinerary,
      trip_meta: sourceTrip.trip_meta,
      packing_list: sourceTrip.packing_list,
      visibility: "private", // Duplicated trips are private
      share_token: null, // No share token for duplicates
      shared_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Insert the duplicated trip
    const { error: insertError } = await supabase
      .from("trips")
      .insert(duplicatedTrip);

    if (insertError) {
      console.error("[Trip Duplicate] Error inserting:", insertError);
      return errors.internal("Failed to save trip to your account", "Trip Duplicate");
    }

    // Complete referral if this is user's first trip (fire and forget)
    void (async () => {
      try {
        // Extract destination from trip title (e.g., "Paris Trip" -> "Paris")
        const destination = sourceTrip.title?.replace(/ Trip$/i, "") || "Unknown";

        // Calculate duration from dates
        const start = new Date(tripStartDate);
        const end = new Date(tripEndDate);
        const durationDays = Math.ceil(
          (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
        ) + 1;

        // Track trip creation in PostHog
        await captureServerEvent(user.id, "trip_created", {
          trip_id: newTripId,
          destination,
          duration_days: durationDays,
          is_from_template: false,
          is_duplicate: true,
          source_trip_id: sourceTrip.id,
        });

        // Complete referral if eligible
        const referralResult = await completeReferralIfEligible(
          supabase,
          user.id,
          newTripId
        );

        if (referralResult.wasReferred && referralResult.refereeRewarded) {
          console.log(`[Trip Duplicate] Referral completed for user ${user.id}`);
        }
      } catch (err) {
        console.error("[Trip Duplicate] Error in referral/tracking:", err);
      }
    })();

    return apiSuccess({
      success: true,
      tripId: newTripId,
      message: "Trip saved to your account!",
      isExisting: false,
    });
  } catch (error) {
    console.error("[Trip Duplicate] Unexpected error:", error);
    return errors.internal("An unexpected error occurred", "Trip Duplicate");
  }
}
