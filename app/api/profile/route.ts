import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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
      console.error("Error fetching profile:", error);
      return NextResponse.json({ error: "Failed to fetch profile" }, { status: 500 });
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

    return NextResponse.json({ profile, stats });
  } catch (error) {
    console.error("Error in profile API:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    // Add updated_at timestamp
    filteredUpdates.updated_at = new Date().toISOString();

    // Validate specific fields
    if (filteredUpdates.display_name) {
      const displayName = String(filteredUpdates.display_name).trim();
      if (displayName.length < 1 || displayName.length > 50) {
        return NextResponse.json(
          { error: "Display name must be between 1 and 50 characters" },
          { status: 400 }
        );
      }
      filteredUpdates.display_name = displayName;
    }

    if (filteredUpdates.bio) {
      const bio = String(filteredUpdates.bio).trim();
      if (bio.length > 200) {
        return NextResponse.json({ error: "Bio must be 200 characters or less" }, { status: 400 });
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
      console.error("Error updating profile:", error);
      return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
    }

    return NextResponse.json({ success: true, profile });
  } catch (error) {
    console.error("Error in profile PATCH:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Note: Full account deletion would require admin privileges
    // For now, we'll just sign out the user and mark for deletion
    // A proper implementation would use Supabase Edge Functions with service role

    // Delete user's trips first (cascade would handle this ideally)
    await supabase.from("trips").delete().eq("user_id", user.id);

    // Delete user profile
    await supabase.from("users").delete().eq("id", user.id);

    // Sign out
    await supabase.auth.signOut();

    return NextResponse.json({ success: true, message: "Account scheduled for deletion" });
  } catch (error) {
    console.error("Error deleting account:", error);
    return NextResponse.json({ error: "Failed to delete account" }, { status: 500 });
  }
}
