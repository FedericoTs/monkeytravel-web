/**
 * Place Details API Route
 *
 * GET /api/places/details?placeId=...
 *
 * Fetches place details including coordinates from Google Places API.
 * Used to get latitude/longitude for accurate seasonal/weather calculations.
 */

import { NextRequest, NextResponse } from "next/server";

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY || "";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const placeId = searchParams.get("placeId");

  if (!placeId) {
    return NextResponse.json(
      { error: "placeId is required" },
      { status: 400 }
    );
  }

  if (!GOOGLE_PLACES_API_KEY) {
    return NextResponse.json(
      { error: "Google Places API key not configured" },
      { status: 500 }
    );
  }

  try {
    // Use Places API (New) to get place details
    const response = await fetch(
      `https://places.googleapis.com/v1/places/${placeId}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
          "X-Goog-FieldMask": "id,displayName,formattedAddress,location,addressComponents",
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Places Details API error:", errorText);
      return NextResponse.json(
        { error: "Failed to fetch place details" },
        { status: 500 }
      );
    }

    const data = await response.json();

    // Extract country code from address components if available
    let countryCode: string | null = null;
    if (data.addressComponents) {
      const countryComponent = data.addressComponents.find(
        (component: { types: string[] }) =>
          component.types.includes("country")
      );
      if (countryComponent) {
        countryCode = countryComponent.shortText;
      }
    }

    return NextResponse.json({
      placeId: data.id,
      name: data.displayName?.text,
      address: data.formattedAddress,
      location: data.location, // { latitude, longitude }
      countryCode,
    });
  } catch (error) {
    console.error("Place Details API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
