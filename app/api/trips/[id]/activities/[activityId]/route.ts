import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface RouteContext {
  params: Promise<{ id: string; activityId: string }>;
}

/**
 * GET /api/trips/[id]/activities/[activityId] - Get timeline for a specific activity
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id: tripId, activityId } = await context.params;
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: timeline, error } = await supabase
      .from("activity_timelines")
      .select("*")
      .eq("trip_id", tripId)
      .eq("activity_id", activityId)
      .eq("user_id", user.id)
      .single();

    if (error && error.code !== "PGRST116") {
      // PGRST116 = no rows returned
      console.error("Error fetching activity timeline:", error);
      return NextResponse.json(
        { error: "Failed to fetch activity timeline" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      timeline: timeline || null,
    });
  } catch (error) {
    console.error("Error fetching activity timeline:", error);
    return NextResponse.json(
      { error: "Failed to fetch activity timeline" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/trips/[id]/activities/[activityId] - Update activity timeline (status, rating, notes)
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id: tripId, activityId } = await context.params;
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify trip ownership
    const { data: trip, error: tripError } = await supabase
      .from("trips")
      .select("id")
      .eq("id", tripId)
      .eq("user_id", user.id)
      .single();

    if (tripError || !trip) {
      return NextResponse.json({ error: "Trip not found" }, { status: 404 });
    }

    const body = await request.json();
    const updates: Record<string, unknown> = {};

    // Handle status update
    if (body.status !== undefined) {
      const validStatuses = ["upcoming", "in_progress", "completed", "skipped"];
      if (!validStatuses.includes(body.status)) {
        return NextResponse.json(
          { error: "Invalid status" },
          { status: 400 }
        );
      }
      updates.status = body.status;

      // Set timestamps based on status
      if (body.status === "in_progress") {
        updates.started_at = new Date().toISOString();
      } else if (body.status === "completed") {
        updates.completed_at = new Date().toISOString();
      }
    }

    // Handle rating
    if (body.rating !== undefined) {
      if (body.rating < 1 || body.rating > 5) {
        return NextResponse.json(
          { error: "Rating must be between 1 and 5" },
          { status: 400 }
        );
      }
      updates.rating = body.rating;
    }

    // Handle notes
    if (body.notes !== undefined) {
      updates.experience_notes = body.notes;
    }

    // Handle quick tags
    if (body.quickTags !== undefined) {
      const validTags = [
        "must-do",
        "crowded",
        "worth-it",
        "skip-next-time",
        "hidden-gem",
        "overrated",
      ];
      const tags = Array.isArray(body.quickTags) ? body.quickTags : [];
      const filteredTags = tags.filter((t: string) => validTags.includes(t));
      updates.quick_tags = filteredTags;
    }

    // Handle skip reason
    if (body.skipReason !== undefined) {
      updates.skip_reason = body.skipReason;
    }

    // Handle actual duration
    if (body.actualDuration !== undefined) {
      updates.actual_duration_minutes = Number(body.actualDuration);
    }

    // Handle day number (for initial creation)
    if (body.dayNumber !== undefined) {
      updates.day_number = Number(body.dayNumber);
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    // Upsert: create if not exists, update if exists
    const { data: timeline, error } = await supabase
      .from("activity_timelines")
      .upsert(
        {
          trip_id: tripId,
          activity_id: activityId,
          user_id: user.id,
          day_number: body.dayNumber || 1,
          ...updates,
        },
        {
          onConflict: "trip_id,activity_id,user_id",
        }
      )
      .select()
      .single();

    if (error) {
      console.error("Error updating activity timeline:", error);
      return NextResponse.json(
        { error: "Failed to update activity timeline" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, timeline });
  } catch (error) {
    console.error("Error updating activity timeline:", error);
    return NextResponse.json(
      { error: "Failed to update activity timeline" },
      { status: 500 }
    );
  }
}
