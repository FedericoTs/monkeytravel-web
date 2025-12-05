import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { v4 as uuidv4 } from "uuid";

/**
 * POST /api/trips/duplicate - Duplicate a shared trip to user's account
 *
 * This endpoint allows authenticated users to copy a shared trip to their own account.
 * The duplicated trip will be private and fully editable by the new owner.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "Please sign in to save this trip" },
        { status: 401 }
      );
    }

    // Get share token from request body
    const body = await request.json();
    const { shareToken } = body;

    if (!shareToken) {
      return NextResponse.json(
        { error: "Share token is required" },
        { status: 400 }
      );
    }

    // Fetch the source trip by share token
    const { data: sourceTrip, error: fetchError } = await supabase
      .from("trips")
      .select("*")
      .eq("share_token", shareToken)
      .single();

    if (fetchError || !sourceTrip) {
      return NextResponse.json(
        { error: "Shared trip not found" },
        { status: 404 }
      );
    }

    // Note: We allow users to duplicate the same trip multiple times
    // Each duplication creates a completely independent copy

    // Create a new trip ID
    const newTripId = uuidv4();

    // Prepare the duplicated trip data
    // Only include columns that exist in the trips table
    const duplicatedTrip: Record<string, unknown> = {
      id: newTripId,
      user_id: user.id,
      title: sourceTrip.title,
      description: sourceTrip.description,
      destination: sourceTrip.destination,
      start_date: sourceTrip.start_date,
      end_date: sourceTrip.end_date,
      status: "draft", // New trips start as draft
      budget: sourceTrip.budget,
      tags: sourceTrip.tags,
      itinerary: sourceTrip.itinerary,
      meta: sourceTrip.meta,
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
      console.error("Error duplicating trip:", insertError);
      return NextResponse.json(
        { error: "Failed to save trip to your account" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      tripId: newTripId,
      message: "Trip saved to your account!",
      isExisting: false,
    });
  } catch (error) {
    console.error("Error in trip duplicate API:", error);
    return NextResponse.json(
      { error: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
