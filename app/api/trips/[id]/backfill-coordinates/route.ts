import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { ItineraryDay, Activity } from "@/types";

/**
 * Backfill Coordinates API
 *
 * Geocodes all activities in a trip that are missing coordinates
 * and updates the trip's itinerary with the resolved coordinates.
 *
 * This improves subsequent load times by eliminating geocoding calls.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: tripId } = await params;
    const supabase = await createClient();

    // Verify authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Fetch the trip
    const { data: trip, error: tripError } = await supabase
      .from("trips")
      .select("id, user_id, itinerary, title")
      .eq("id", tripId)
      .single();

    if (tripError || !trip) {
      return NextResponse.json(
        { error: "Trip not found" },
        { status: 404 }
      );
    }

    // Verify ownership
    if (trip.user_id !== user.id) {
      return NextResponse.json(
        { error: "Not authorized to modify this trip" },
        { status: 403 }
      );
    }

    const itinerary = trip.itinerary as ItineraryDay[];
    if (!itinerary || !Array.isArray(itinerary)) {
      return NextResponse.json(
        { error: "Invalid itinerary format" },
        { status: 400 }
      );
    }

    // Extract destination from title (e.g., "Trieste Trip" -> "Trieste")
    const destination = trip.title?.replace(" Trip", "") || "";

    // Collect activities missing coordinates
    const activitiesToGeocode: {
      dayIndex: number;
      activityIndex: number;
      address: string;
    }[] = [];

    for (let dayIndex = 0; dayIndex < itinerary.length; dayIndex++) {
      const day = itinerary[dayIndex];
      for (let activityIndex = 0; activityIndex < day.activities.length; activityIndex++) {
        const activity = day.activities[activityIndex];
        if (!activity.coordinates?.lat || !activity.coordinates?.lng) {
          const address = activity.address || activity.location;
          if (address) {
            activitiesToGeocode.push({
              dayIndex,
              activityIndex,
              address: `${address}, ${destination}`,
            });
          }
        }
      }
    }

    if (activitiesToGeocode.length === 0) {
      return NextResponse.json({
        success: true,
        message: "All activities already have coordinates",
        updated: 0,
      });
    }

    // Batch geocode all addresses
    const addresses = activitiesToGeocode.map((a) => a.address);
    const geocodeResponse = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/travel/geocode`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addresses }),
      }
    );

    if (!geocodeResponse.ok) {
      const errorText = await geocodeResponse.text();
      console.error("[Backfill] Geocoding failed:", errorText);
      return NextResponse.json(
        { error: "Geocoding service unavailable" },
        { status: 503 }
      );
    }

    const geocodeData = await geocodeResponse.json();
    const geocodedMap = new Map<string, { lat: number; lng: number }>();

    for (const result of geocodeData.results || []) {
      geocodedMap.set(result.address, { lat: result.lat, lng: result.lng });
    }

    // Update itinerary with coordinates
    let updatedCount = 0;
    const updatedItinerary = [...itinerary];

    for (const { dayIndex, activityIndex, address } of activitiesToGeocode) {
      const coords = geocodedMap.get(address);
      if (coords) {
        updatedItinerary[dayIndex].activities[activityIndex] = {
          ...updatedItinerary[dayIndex].activities[activityIndex],
          coordinates: coords,
        };
        updatedCount++;
      }
    }

    // Save updated itinerary if any coordinates were added
    if (updatedCount > 0) {
      const { error: updateError } = await supabase
        .from("trips")
        .update({ itinerary: updatedItinerary })
        .eq("id", tripId);

      if (updateError) {
        console.error("[Backfill] Update error:", updateError);
        return NextResponse.json(
          { error: "Failed to update trip" },
          { status: 500 }
        );
      }
    }

    console.log(`[Backfill] Trip ${tripId}: Updated ${updatedCount}/${activitiesToGeocode.length} activities`);

    return NextResponse.json({
      success: true,
      message: `Updated ${updatedCount} activities with coordinates`,
      updated: updatedCount,
      total: activitiesToGeocode.length,
      failed: activitiesToGeocode.length - updatedCount,
    });
  } catch (error) {
    console.error("[Backfill] Error:", error);
    return NextResponse.json(
      { error: "Failed to backfill coordinates" },
      { status: 500 }
    );
  }
}
