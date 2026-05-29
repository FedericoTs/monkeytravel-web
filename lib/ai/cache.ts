/**
 * Destination activity cache helpers.
 *
 * Shared between /api/ai/generate (JSON) and /api/ai/generate/stream
 * (SSE). Both paths use the same cache key:
 *   (destination_hash, budget_tier, vibes, language, travel_style)
 * — extended 2026-05-28 to include travel_style (Tier 1.2 migration).
 *
 * Originally lived inside the JSON route only; extracted to a shared
 * module so the streaming route — which is the PRIMARY generation
 * path (~40% of all generations) — can also short-circuit on cache
 * hit instead of always calling Gemini. Before this extraction the
 * cache hit rate was 0% across 158 generations in 30 days.
 */

import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GeneratedItinerary } from "@/types";

export type SupportedLanguage = "en" | "es" | "it";
export type TravelStyle = "classic" | "backpacker";

/** MD5 of the lowercased + collapsed destination. Stable across casing. */
export function hashDestination(destination: string): string {
  const normalized = destination.toLowerCase().trim().replace(/\s+/g, " ");
  return crypto.createHash("md5").update(normalized).digest("hex");
}

/**
 * Adjust cached itinerary dates to the user's requested window.
 * The cache stores absolute dates from the original generation; on
 * cache hit we shift them so the user sees their own dates.
 */
export function adjustItineraryDates(
  itinerary: GeneratedItinerary,
  startDate: string,
  endDate: string,
): GeneratedItinerary {
  const start = new Date(startDate);
  const requestedDays =
    Math.ceil(
      (new Date(endDate).getTime() - start.getTime()) / (1000 * 60 * 60 * 24),
    ) + 1;

  const adjustedDays = itinerary.days.slice(0, requestedDays).map((day, index) => {
    const dayDate = new Date(start);
    dayDate.setDate(dayDate.getDate() + index);
    return {
      ...day,
      day_number: index + 1,
      date: dayDate.toISOString().split("T")[0],
    };
  });

  return { ...itinerary, days: adjustedDays };
}

/**
 * Look up a cached itinerary. Returns null on miss or any error
 * (silent — callers always have a generation fallback).
 *
 * Also atomically bumps hit_count in the background (fire-and-forget).
 */
export async function getCachedItinerary(
  supabase: SupabaseClient,
  destination: string,
  vibes: string[],
  budgetTier: string,
  language: SupportedLanguage,
  travelStyle: TravelStyle = "classic",
): Promise<GeneratedItinerary | null> {
  const destinationHash = hashDestination(destination);
  const sortedVibes = [...vibes].sort();

  const { data, error } = await supabase
    .from("destination_activity_cache")
    .select("*")
    .eq("destination_hash", destinationHash)
    .eq("budget_tier", budgetTier)
    .eq("language", language)
    .eq("travel_style", travelStyle)
    .contains("vibes", sortedVibes)
    .gt("expires_at", new Date().toISOString())
    .order("hit_count", { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return null;

  // Background hit-count bump. Atomic RPC preferred; .then() update is
  // the fallback if the RPC doesn't exist in this env.
  void supabase
    .rpc("increment_cache_hit_count", { cache_id: data.id })
    .then((res) => {
      if (res.error) {
        void supabase
          .from("destination_activity_cache")
          .update({
            hit_count: (data.hit_count || 0) + 1,
            last_accessed_at: new Date().toISOString(),
          })
          .eq("id", data.id)
          .then(() => undefined);
      }
    });

  return {
    destination:
      data.trip_summary?.destination ?? {
        name: destination,
        country: "",
        description: "",
      },
    days: data.activities,
    trip_summary: data.trip_summary?.trip_summary,
    booking_links: data.trip_summary?.booking_links,
  } as GeneratedItinerary;
}

/**
 * Write a fresh itinerary to the cache for 14 days.
 *
 * Idempotent via the unique (destination_hash, budget_tier, vibes,
 * language, travel_style) constraint — repeat saves overwrite.
 * Failures are logged but never thrown — callers should never have
 * their happy path blocked by a cache miss.
 */
export async function cacheItinerary(
  supabase: SupabaseClient,
  destination: string,
  vibes: string[],
  budgetTier: string,
  language: SupportedLanguage,
  itinerary: GeneratedItinerary,
  travelStyle: TravelStyle = "classic",
): Promise<void> {
  const destinationHash = hashDestination(destination);
  const sortedVibes = [...vibes].sort();
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  try {
    const { error } = await supabase.from("destination_activity_cache").upsert(
      {
        destination_hash: destinationHash,
        destination_name: destination,
        vibes: sortedVibes,
        budget_tier: budgetTier,
        language,
        travel_style: travelStyle,
        activities: itinerary.days,
        trip_summary: {
          destination: itinerary.destination,
          trip_summary: itinerary.trip_summary,
          booking_links: itinerary.booking_links,
        },
        expires_at: expiresAt.toISOString(),
        hit_count: 0,
        last_accessed_at: new Date().toISOString(),
      },
      { onConflict: "destination_hash,budget_tier,vibes,language,travel_style" },
    );

    if (error) {
      console.error(
        `[ai/cache] write error for ${destination}:`,
        error.message,
        error.details,
      );
    } else {
      console.log(
        `[ai/cache] wrote ${destination} (vibes: ${sortedVibes.join(", ")}, budget: ${budgetTier}, language: ${language}, style: ${travelStyle})`,
      );
    }
  } catch (err) {
    console.error("[ai/cache] write exception:", err);
  }
}
