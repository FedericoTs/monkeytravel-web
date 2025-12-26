/**
 * Destinations Upsert API
 *
 * POST /api/destinations/upsert
 *
 * Automatically saves Google-sourced destinations to the local database.
 * This enriches our destination database over time, reducing future API costs.
 *
 * - If destination exists: update coordinates if missing, bump rating
 * - If destination is new: insert with sensible defaults
 *
 * Cost: $0 (local database operation)
 */

import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";

interface UpsertRequest {
  name: string;
  country: string;
  latitude: number;
  longitude: number;
  placeId?: string;
  countryCode?: string | null;
}

export async function POST(request: NextRequest) {
  try {
    const body: UpsertRequest = await request.json();
    const { name, country, latitude, longitude, placeId, countryCode } = body;

    // Validate required fields
    if (!name || !country || latitude === undefined || longitude === undefined) {
      return errors.badRequest("Missing required fields: name, country, latitude, longitude");
    }

    // Validate coordinates
    if (
      typeof latitude !== "number" ||
      typeof longitude !== "number" ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      return errors.badRequest("Invalid coordinates");
    }

    const supabase = await createClient();

    // Check if destination already exists (case-insensitive match)
    const { data: existing, error: findError } = await supabase
      .from("destinations")
      .select("id, name, country, latitude, longitude, rating, google_place_id")
      .ilike("name", name.trim())
      .ilike("country", country.trim())
      .limit(1)
      .maybeSingle();

    if (findError) {
      console.error("[Destinations Upsert] Error finding destination:", findError);
      return errors.internal("Database error", "Destinations Upsert");
    }

    if (existing) {
      // Destination exists - update if needed
      const updates: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };

      // Update coordinates if missing
      if (!existing.latitude || !existing.longitude) {
        updates.latitude = latitude;
        updates.longitude = longitude;
      }

      // Store Google Place ID if not already set
      if (placeId && !existing.google_place_id) {
        updates.google_place_id = placeId;
      }

      // Bump rating slightly (max 100) to prioritize user-selected destinations
      const currentRating = Number(existing.rating) || 50;
      if (currentRating < 100) {
        updates.rating = Math.min(currentRating + 1, 100);
      }

      // Only update if there are meaningful changes
      if (Object.keys(updates).length > 1) {
        const { error: updateError } = await supabase
          .from("destinations")
          .update(updates)
          .eq("id", existing.id);

        if (updateError) {
          console.error("[Destinations Upsert] Error updating destination:", updateError);
          // Non-critical, don't fail the request
        } else {
          console.log(`[Destinations] Updated: ${name}, ${country}`);
        }
      }

      return apiSuccess({
        action: "updated",
        id: existing.id,
        name: existing.name,
        country: existing.country,
      });
    }

    // Destination doesn't exist - insert new
    // Use the city name as the city field value
    const cityName = name.trim();

    const { data: inserted, error: insertError } = await supabase
      .from("destinations")
      .insert({
        name: name.trim(),
        country: country.trim(),
        city: cityName,
        description: `${name.trim()} is a destination in ${country.trim()}.`,
        latitude,
        longitude,
        location: `POINT(${longitude} ${latitude})`, // PostGIS format
        price_range: "$$", // Default medium price range
        rating: 50, // Start with neutral rating
        google_place_id: placeId || null,
        tags: countryCode ? [countryCode.toUpperCase()] : [],
        image_urls: [],
        best_time_to_visit: {},
        favorites_count: 0,
        visits_count: 0,
        average_stay_days: 3,
      })
      .select("id, name, country")
      .single();

    if (insertError) {
      // Check if it's a duplicate constraint error (race condition)
      if (insertError.code === "23505") {
        console.log(`[Destinations Upsert] Duplicate detected (race): ${name}, ${country}`);
        return apiSuccess({
          action: "already_exists",
          name: name.trim(),
          country: country.trim(),
        });
      }

      console.error("[Destinations Upsert] Error inserting destination:", insertError);
      return errors.internal("Failed to insert destination", "Destinations Upsert");
    }

    console.log(`[Destinations Upsert] Inserted: ${name}, ${country} (from Google Places)`);

    return apiSuccess({
      action: "inserted",
      id: inserted.id,
      name: inserted.name,
      country: inserted.country,
    });
  } catch (error) {
    console.error("[Destinations Upsert] Destinations upsert error:", error);
    return errors.internal("Internal server error", "Destinations Upsert");
  }
}
