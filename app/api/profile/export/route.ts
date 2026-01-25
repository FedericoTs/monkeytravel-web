import { createClient } from "@/lib/supabase/server";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { getAuthenticatedUser } from "@/lib/api/auth";

/**
 * GET /api/profile/export
 *
 * GDPR Article 20 - Right to Data Portability
 *
 * Exports all user data in JSON format:
 * - User profile information
 * - All trips and itineraries
 * - AI conversations
 * - Preferences and settings
 * - Activity timelines and checklists
 *
 * Rate limited to 1 request per day per user.
 */
export async function GET() {
  const { user, errorResponse } = await getAuthenticatedUser();
  if (errorResponse) return errorResponse;

  const userId = user.id;
  const supabase = await createClient();

  try {
    // Check rate limit (1 export per day)
    const oneDay = 24 * 60 * 60 * 1000;
    const rateLimitKey = `data_export:${userId}`;

    // For simplicity, we'll track in user metadata
    // In production, you might use Redis or a dedicated rate limit table
    const { data: userData } = await supabase
      .from("users")
      .select("preferences")
      .eq("id", userId)
      .single();

    const lastExport = userData?.preferences?.lastDataExport;
    if (lastExport && Date.now() - new Date(lastExport).getTime() < oneDay) {
      return errors.rateLimit(
        "You can only export your data once per day. Please try again later.",
        { rateLimitType: "daily_export" }
      );
    }

    // Fetch all user data in parallel
    const [
      profileResult,
      tripsResult,
      conversationsResult,
      timelinesResult,
      checklistsResult,
      usageResult,
      aiUsageResult,
    ] = await Promise.all([
      // User profile
      supabase
        .from("users")
        .select(
          `
          id,
          email,
          display_name,
          avatar_url,
          bio,
          home_country,
          home_city,
          date_of_birth,
          languages,
          preferences,
          notification_settings,
          privacy_settings,
          cookie_consent,
          preferred_language,
          created_at,
          updated_at
        `
        )
        .eq("id", userId)
        .single(),

      // All trips with activities
      supabase
        .from("trips")
        .select(
          `
          id,
          title,
          destination,
          start_date,
          end_date,
          status,
          budget_tier,
          itinerary,
          preferences,
          share_token,
          is_public,
          created_at,
          updated_at
        `
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: false }),

      // AI conversations
      supabase
        .from("ai_conversations")
        .select(
          `
          id,
          trip_id,
          messages,
          created_at,
          updated_at
        `
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: false }),

      // Activity timelines
      supabase
        .from("activity_timelines")
        .select(
          `
          id,
          trip_id,
          activity_id,
          status,
          started_at,
          completed_at,
          rating,
          notes,
          created_at
        `
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: false }),

      // Trip checklists
      supabase
        .from("trip_checklists")
        .select(
          `
          id,
          trip_id,
          items,
          created_at,
          updated_at
        `
        )
        .eq("user_id", userId),

      // User usage stats
      supabase
        .from("user_usage")
        .select(
          `
          id,
          trips_generated,
          trips_regenerated,
          ai_requests_used,
          last_activity_at,
          created_at,
          updated_at
        `
        )
        .eq("user_id", userId)
        .single(),

      // AI usage history
      supabase
        .from("ai_usage")
        .select(
          `
          id,
          action_type,
          model_used,
          tokens_input,
          tokens_output,
          cost_estimate,
          metadata,
          created_at
        `
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1000), // Limit to last 1000 entries
    ]);

    // Compile export data
    const exportData = {
      exportInfo: {
        exportedAt: new Date().toISOString(),
        userId,
        version: "1.0",
        dataRetentionNote:
          "This export contains all your personal data stored by MonkeyTravel. " +
          "Some aggregated analytics data may not be included as it is anonymized.",
      },
      profile: profileResult.data || null,
      trips: tripsResult.data || [],
      aiConversations: conversationsResult.data || [],
      activityTimelines: timelinesResult.data || [],
      tripChecklists: checklistsResult.data || [],
      usage: usageResult.data || null,
      aiUsageHistory: aiUsageResult.data || [],
    };

    // Update last export timestamp
    await supabase
      .from("users")
      .update({
        preferences: {
          ...(userData?.preferences || {}),
          lastDataExport: new Date().toISOString(),
        },
      })
      .eq("id", userId);

    // Return as JSON download
    const filename = `monkeytravel-data-export-${new Date().toISOString().split("T")[0]}.json`;

    return new Response(JSON.stringify(exportData, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[Data Export] Export failed:", error);
    return errors.internal("Failed to export data", "Data Export");
  }
}
