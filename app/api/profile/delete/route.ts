import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

/**
 * DELETE /api/profile/delete
 *
 * Permanently deletes the authenticated user's account and all associated data.
 * This includes:
 * - All trips and itineraries
 * - AI conversations and usage records
 * - User preferences and settings
 * - Trip checklists and activity timelines
 * - Memories and expenses
 * - Notifications and search history
 *
 * Analytics data (page_views, api_request_logs) is anonymized rather than deleted.
 */
export async function DELETE() {
  const supabase = await createClient();

  // Get authenticated user
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
      console.error("Error deleting trip_checklists:", checklistError);
    }

    // Activity timelines
    const { error: timelineError } = await adminClient
      .from("activity_timelines")
      .delete()
      .eq("user_id", userId);
    if (timelineError) {
      console.error("Error deleting activity_timelines:", timelineError);
    }

    // Memories
    const { error: memoriesError } = await adminClient
      .from("memories")
      .delete()
      .eq("user_id", userId);
    if (memoriesError) {
      console.error("Error deleting memories:", memoriesError);
    }

    // Expenses
    const { error: expensesError } = await adminClient
      .from("expenses")
      .delete()
      .eq("user_id", userId);
    if (expensesError) {
      console.error("Error deleting expenses:", expensesError);
    }

    // Notifications
    const { error: notificationsError } = await adminClient
      .from("notifications")
      .delete()
      .eq("user_id", userId);
    if (notificationsError) {
      console.error("Error deleting notifications:", notificationsError);
    }

    // Search history
    const { error: searchError } = await adminClient
      .from("search_history")
      .delete()
      .eq("user_id", userId);
    if (searchError) {
      console.error("Error deleting search_history:", searchError);
    }

    // Travel posts
    const { error: postsError } = await adminClient
      .from("travel_posts")
      .delete()
      .eq("user_id", userId);
    if (postsError) {
      console.error("Error deleting travel_posts:", postsError);
    }

    // User favorites
    const { error: favoritesError } = await adminClient
      .from("user_favorites")
      .delete()
      .eq("user_id", userId);
    if (favoritesError) {
      console.error("Error deleting user_favorites:", favoritesError);
    }

    // User visited destinations
    const { error: visitedError } = await adminClient
      .from("user_visited_destinations")
      .delete()
      .eq("user_id", userId);
    if (visitedError) {
      console.error("Error deleting user_visited_destinations:", visitedError);
    }

    // User relationships (both as follower and following)
    const { error: relFollowerError } = await adminClient
      .from("user_relationships")
      .delete()
      .eq("follower_id", userId);
    if (relFollowerError) {
      console.error(
        "Error deleting user_relationships (follower):",
        relFollowerError
      );
    }

    const { error: relFollowingError } = await adminClient
      .from("user_relationships")
      .delete()
      .eq("following_id", userId);
    if (relFollowingError) {
      console.error(
        "Error deleting user_relationships (following):",
        relFollowingError
      );
    }

    // Trip collaborators (both as user and inviter)
    const { error: collabUserError } = await adminClient
      .from("trip_collaborators")
      .delete()
      .eq("user_id", userId);
    if (collabUserError) {
      console.error(
        "Error deleting trip_collaborators (user):",
        collabUserError
      );
    }

    const { error: collabInviterError } = await adminClient
      .from("trip_collaborators")
      .delete()
      .eq("invited_by", userId);
    if (collabInviterError) {
      console.error(
        "Error deleting trip_collaborators (inviter):",
        collabInviterError
      );
    }

    // Phase 2: Delete AI/usage records
    const { error: aiConvoError } = await adminClient
      .from("ai_conversations")
      .delete()
      .eq("user_id", userId);
    if (aiConvoError) {
      console.error("Error deleting ai_conversations:", aiConvoError);
    }

    const { error: aiUsageError } = await adminClient
      .from("ai_usage")
      .delete()
      .eq("user_id", userId);
    if (aiUsageError) {
      console.error("Error deleting ai_usage:", aiUsageError);
    }

    const { error: userUsageError } = await adminClient
      .from("user_usage")
      .delete()
      .eq("user_id", userId);
    if (userUsageError) {
      console.error("Error deleting user_usage:", userUsageError);
    }

    // Phase 3: Anonymize analytics (preserve data, remove PII)
    const { error: pageViewsError } = await adminClient
      .from("page_views")
      .update({ user_id: null })
      .eq("user_id", userId);
    if (pageViewsError) {
      console.error("Error anonymizing page_views:", pageViewsError);
    }

    const { error: apiLogsError } = await adminClient
      .from("api_request_logs")
      .update({ user_id: null })
      .eq("user_id", userId);
    if (apiLogsError) {
      console.error("Error anonymizing api_request_logs:", apiLogsError);
    }

    // Phase 4: Delete trips (main content)
    const { error: tripsError } = await adminClient
      .from("trips")
      .delete()
      .eq("user_id", userId);
    if (tripsError) {
      console.error("Error deleting trips:", tripsError);
      throw new Error("Failed to delete trips");
    }

    // Phase 5: Delete user profile
    const { error: userError } = await adminClient
      .from("users")
      .delete()
      .eq("id", userId);
    if (userError) {
      console.error("Error deleting user profile:", userError);
      throw new Error("Failed to delete user profile");
    }

    // Phase 6: Delete auth user (via Admin API)
    const { error: deleteAuthError } =
      await adminClient.auth.admin.deleteUser(userId);

    if (deleteAuthError) {
      console.error("Error deleting auth user:", deleteAuthError);
      throw new Error("Failed to delete authentication record");
    }

    console.log(`Successfully deleted account for user: ${userId}`);

    return NextResponse.json({
      success: true,
      message: "Account deleted successfully",
    });
  } catch (error) {
    console.error("Account deletion failed:", error);
    return NextResponse.json(
      {
        error: "Failed to delete account",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
