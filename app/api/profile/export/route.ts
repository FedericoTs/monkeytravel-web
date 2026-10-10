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
          description,
          start_date,
          end_date,
          status,
          visibility,
          budget,
          itinerary,
          trip_meta,
          packing_list,
          notes,
          tags,
          travel_style,
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
          day_number,
          status,
          started_at,
          completed_at,
          actual_duration_minutes,
          rating,
          experience_notes,
          quick_tags,
          skip_reason,
          created_at,
          updated_at
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
          text,
          category,
          is_checked,
          due_date,
          created_at,
          checked_at
        `
        )
        .eq("user_id", userId),

      // User usage stats
      supabase
        .from("user_usage")
        .select(
          `
          id,
          period_type,
          period_key,
          ai_generations_used,
          ai_regenerations_used,
          ai_assistant_messages_used,
          ai_tokens_used,
          places_autocomplete_used,
          places_search_used,
          places_details_used,
          created_at,
          updated_at
        `
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: false }),

      // AI usage history
      supabase
        .from("ai_usage")
        .select(
          `
          id,
          trip_id,
          action,
          model_id,
          input_tokens,
          output_tokens,
          cost_cents,
          created_at
        `
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1000), // Limit to last 1000 entries
    ]);

    // The file says it holds all of the person's data, so a section that failed
    // to load fails the export instead of shipping empty. Nothing is stamped,
    // so they can try again.
    const sections = { profileResult, tripsResult, conversationsResult, timelinesResult, checklistsResult, usageResult, aiUsageResult };
    const failed = Object.entries(sections)
      .filter(([, r]) => r.error)
      .map(([name, r]) => `${name}: ${r.error?.message}`);
    if (failed.length > 0) {
      console.error("[Data Export] sections failed:", failed);
      return errors.internal("Failed to export data", "Data Export");
    }

    // Compile export data
    const exportData = {
      exportInfo: {
        exportedAt: new Date().toISOString(),
        userId,
        version: "1.1",
        dataRetentionNote:
          "This export contains all your personal data stored by MonkeyTravel. " +
          "Some aggregated analytics data may not be included as it is anonymized.",
      },
      profile: profileResult.data || null,
      trips: tripsResult.data || [],
      aiConversations: conversationsResult.data || [],
      activityTimelines: timelinesResult.data || [],
      tripChecklists: checklistsResult.data || [],
      usage: usageResult.data || [],
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
