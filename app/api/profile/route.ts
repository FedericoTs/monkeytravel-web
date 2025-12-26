import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { getAuthenticatedUser } from "@/lib/api/auth";

export async function GET() {
  try {
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // Fetch user profile
    const { data: profile, error } = await supabase
      .from("users")
      .select(`
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
        stats,
        created_at,
        last_sign_in_at
      `)
      .eq("id", user.id)
      .single();

    if (error) {
      console.error("[Profile] Error fetching profile:", error);
      return errors.internal("Failed to fetch profile", "Profile");
    }

    // Fetch trip statistics
    const { data: trips } = await supabase
      .from("trips")
      .select("id, start_date, end_date, status")
      .eq("user_id", user.id);

    const stats = {
      totalTrips: trips?.length || 0,
      upcomingTrips: trips?.filter((t) => new Date(t.start_date) > new Date()).length || 0,
      totalTravelDays: trips?.reduce((acc, trip) => {
        if (trip.start_date && trip.end_date) {
          const start = new Date(trip.start_date);
          const end = new Date(trip.end_date);
          return acc + Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
        }
        return acc;
      }, 0) || 0,
    };

    return apiSuccess({ profile, stats });
  } catch (error) {
    console.error("[Profile] Error in profile API:", error);
    return errors.internal("Internal server error", "Profile");
  }
}

export async function PATCH(request: Request) {
  try {
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    const updates = await request.json();

    // Validate allowed fields
    const allowedFields = [
      "display_name",
      "avatar_url",
      "bio",
      "home_country",
      "home_city",
      "date_of_birth",
      "languages",
      "preferences",
      "notification_settings",
      "privacy_settings",
    ];

    const filteredUpdates: Record<string, unknown> = {};
    for (const key of Object.keys(updates)) {
      if (allowedFields.includes(key)) {
        filteredUpdates[key] = updates[key];
      }
    }

    if (Object.keys(filteredUpdates).length === 0) {
      return errors.badRequest("No valid fields to update");
    }

    // Add updated_at timestamp
    filteredUpdates.updated_at = new Date().toISOString();

    // Validate specific fields
    if (filteredUpdates.display_name) {
      const displayName = String(filteredUpdates.display_name).trim();
      if (displayName.length < 1 || displayName.length > 50) {
        return errors.badRequest("Display name must be between 1 and 50 characters");
      }
      filteredUpdates.display_name = displayName;
    }

    if (filteredUpdates.bio) {
      const bio = String(filteredUpdates.bio).trim();
      if (bio.length > 200) {
        return errors.badRequest("Bio must be 200 characters or less");
      }
      filteredUpdates.bio = bio;
    }

    // Update profile
    const { data: profile, error } = await supabase
      .from("users")
      .update(filteredUpdates)
      .eq("id", user.id)
      .select()
      .single();

    if (error) {
      console.error("[Profile] Error updating profile:", error);
      return errors.internal("Failed to update profile", "Profile");
    }

    return apiSuccess({ success: true, profile });
  } catch (error) {
    console.error("[Profile] Error in profile PATCH:", error);
    return errors.internal("Internal server error", "Profile");
  }
}

export async function DELETE() {
  try {
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // Note: Full account deletion would require admin privileges
    // For now, we'll just sign out the user and mark for deletion
    // A proper implementation would use Supabase Edge Functions with service role

    // Delete user's trips first (cascade would handle this ideally)
    await supabase.from("trips").delete().eq("user_id", user.id);

    // Delete user profile
    await supabase.from("users").delete().eq("id", user.id);

    // Sign out
    await supabase.auth.signOut();

    return apiSuccess({ success: true, message: "Account scheduled for deletion" });
  } catch (error) {
    console.error("[Profile] Error deleting account:", error);
    return errors.internal("Failed to delete account", "Profile");
  }
}
