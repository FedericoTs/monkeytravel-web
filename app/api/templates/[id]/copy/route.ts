import { NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { generateActivityId } from "@/lib/utils/activity-id";
import type { ItineraryDay, Activity } from "@/types";
import { completeReferralIfEligible } from "@/lib/referral/completion";
import { captureServerEvent } from "@/lib/posthog/server";

/**
 * POST /api/templates/[id]/copy
 *
 * Copy a template trip to the user's trips with custom dates
 *
 * Body:
 * - startDate: string (ISO date) - When the trip starts
 * - endDate: string (ISO date) - When the trip ends (optional, calculated from duration)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: templateId } = await params;
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // Parse request body
    const body = await request.json();
    const { startDate } = body;

    if (!startDate) {
      return errors.badRequest("startDate is required");
    }

    // Fetch the template
    const { data: template, error: fetchError } = await supabase
      .from("trips")
      .select("*")
      .eq("id", templateId)
      .eq("is_template", true)
      .single();

    if (fetchError || !template) {
      return errors.notFound("Template not found");
    }

    // Calculate end date based on template duration
    const start = new Date(startDate);
    const durationDays = template.template_duration_days || template.itinerary?.length || 7;
    const end = new Date(start);
    end.setDate(end.getDate() + durationDays - 1);

    // Adjust itinerary dates and regenerate activity IDs
    const adjustedItinerary: ItineraryDay[] = (template.itinerary || []).map(
      (day: ItineraryDay, index: number) => {
        const dayDate = new Date(start);
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

    // Create the new trip for the user
    const newTrip = {
      user_id: user.id,
      title: template.title,
      description: template.description,
      start_date: startDate,
      end_date: end.toISOString().split("T")[0],
      status: "planning",
      visibility: "private",
      cover_image_url: template.cover_image_url,
      tags: template.tags,
      budget: template.budget,
      itinerary: adjustedItinerary,
      trip_meta: template.trip_meta,
      packing_list: template.packing_list,
      // Don't copy template fields - this is a regular trip
      is_template: false,
    };

    const { data: createdTrip, error: createError } = await supabase
      .from("trips")
      .insert(newTrip)
      .select("id, title")
      .single();

    if (createError) {
      console.error("[Template Copy] Error creating trip:", createError);
      return errors.internal("Failed to create trip from template", "Template Copy");
    }

    // Increment the template's copy count (fire and forget)
    void (async () => {
      try {
        await supabase
          .from("trips")
          .update({ template_copy_count: (template.template_copy_count || 0) + 1 })
          .eq("id", templateId);
        console.log(`[Template Copy] Incremented copy count for template ${templateId}`);
      } catch (err) {
        console.error("[Template Copy] Failed to increment copy count:", err);
      }
    })();

    // Complete referral if this is user's first trip (fire and forget)
    void (async () => {
      try {
        // Extract destination from template title (e.g., "Rome Trip" -> "Rome")
        const destination = template.title?.replace(/ Trip$/i, "") || "Unknown";

        // Track trip creation in PostHog
        await captureServerEvent(user.id, "trip_created", {
          trip_id: createdTrip.id,
          destination,
          duration_days: durationDays,
          is_from_template: true,
          template_id: templateId,
        });

        // Complete referral if eligible
        const referralResult = await completeReferralIfEligible(
          supabase,
          user.id,
          createdTrip.id
        );

        if (referralResult.wasReferred && referralResult.refereeRewarded) {
          console.log(`[Template Copy] Referral completed for user ${user.id}`);
        }
      } catch (err) {
        console.error("[Template Copy] Error in referral/tracking:", err);
      }
    })();

    return apiSuccess({
      success: true,
      trip: {
        id: createdTrip.id,
        title: createdTrip.title,
      },
      message: "Trip created from template",
    });
  } catch (error) {
    console.error("[Template Copy] Unexpected error:", error);
    return errors.internal("Internal server error", "Template Copy");
  }
}
