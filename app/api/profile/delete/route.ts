import { createAdminClient } from "@/lib/supabase/admin";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { getAuthenticatedUser } from "@/lib/api/auth";

/**
 * DELETE /api/profile/delete
 *
 * Permanently deletes the authenticated user's account and all associated data.
 * This includes:
 * - All trips and itineraries
 * - AI conversations and usage records
 * - User preferences and settings
 * - Trip checklists and activity timelines
 *
 * Analytics data (page_views, api_request_logs) is anonymized rather than deleted.
 */
export async function DELETE() {
  const { user, errorResponse } = await getAuthenticatedUser();
  if (errorResponse) return errorResponse;

  const userId = user.id;

  // Create admin client for deletion operations
  const adminClient = createAdminClient();

  try {
    // Phase 1: Delete records that reference user indirectly
    // These tables have user_id foreign keys

    // Trip checklists
    const { error: checklistError } = await adminClient
      .from("trip_checklists")
      .delete()
      .eq("user_id", userId);
    if (checklistError) {
      console.error("[Profile Delete] Error deleting trip_checklists:", checklistError);
    }

    // Activity timelines
    const { error: timelineError } = await adminClient
      .from("activity_timelines")
      .delete()
      .eq("user_id", userId);
    if (timelineError) {
      console.error("[Profile Delete] Error deleting activity_timelines:", timelineError);
    }

    // Phase 2: Delete AI/usage records
    const { error: aiConvoError } = await adminClient
      .from("ai_conversations")
      .delete()
      .eq("user_id", userId);
    if (aiConvoError) {
      console.error("[Profile Delete] Error deleting ai_conversations:", aiConvoError);
    }

    const { error: aiUsageError } = await adminClient
      .from("ai_usage")
      .delete()
      .eq("user_id", userId);
    if (aiUsageError) {
      console.error("[Profile Delete] Error deleting ai_usage:", aiUsageError);
    }

    const { error: userUsageError } = await adminClient
      .from("user_usage")
      .delete()
      .eq("user_id", userId);
    if (userUsageError) {
      console.error("[Profile Delete] Error deleting user_usage:", userUsageError);
    }

    // Phase 3: Anonymize analytics (preserve data, remove PII)
    const { error: pageViewsError } = await adminClient
      .from("page_views")
      .update({ user_id: null })
      .eq("user_id", userId);
    if (pageViewsError) {
      console.error("[Profile Delete] Error anonymizing page_views:", pageViewsError);
    }

    const { error: apiLogsError } = await adminClient
      .from("api_request_logs")
      .update({ user_id: null })
      .eq("user_id", userId);
    if (apiLogsError) {
      console.error("[Profile Delete] Error anonymizing api_request_logs:", apiLogsError);
    }

    // Phase 4: Delete trips (main content)
    const { error: tripsError } = await adminClient
      .from("trips")
      .delete()
      .eq("user_id", userId);
    if (tripsError) {
      console.error("[Profile Delete] Error deleting trips:", tripsError);
      throw new Error("Failed to delete trips");
    }

    // Phase 5: Delete user profile
    const { error: userError } = await adminClient
      .from("users")
      .delete()
      .eq("id", userId);
    if (userError) {
      console.error("[Profile Delete] Error deleting user profile:", userError);
      throw new Error("Failed to delete user profile");
    }

    // Phase 6: Delete auth user (via Admin API)
    const { error: deleteAuthError } =
      await adminClient.auth.admin.deleteUser(userId);

    if (deleteAuthError) {
      console.error("[Profile Delete] Error deleting auth user:", deleteAuthError);
      throw new Error("Failed to delete authentication record");
    }

    console.log(`[Profile Delete] Successfully deleted account for user: ${userId}`);

    return apiSuccess({
      success: true,
      message: "Account deleted successfully",
    });
  } catch (error) {
    console.error("[Profile Delete] Account deletion failed:", error);
    return errors.internal(
      "Failed to delete account",
      "Profile Delete"
    );
  }
}
