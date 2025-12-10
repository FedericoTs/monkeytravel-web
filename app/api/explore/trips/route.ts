import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/explore/trips
 * Returns trending public trips with optional filters
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // Parse filters
    const destination = searchParams.get("destination");
    const durationMin = searchParams.get("duration_min");
    const durationMax = searchParams.get("duration_max");
    const budgetTier = searchParams.get("budget");
    const tags = searchParams.get("tags")?.split(",").filter(Boolean);
    const page = parseInt(searchParams.get("page") || "1");
    const perPage = Math.min(parseInt(searchParams.get("per_page") || "12"), 50);

    const supabase = await createClient();

    // Build query
    let query = supabase
      .from("trips")
      .select(`
        id,
        title,
        description,
        start_date,
        end_date,
        tags,
        cover_image_url,
        share_token,
        shared_at,
        trending_score,
        view_count,
        template_copy_count,
        budget,
        itinerary,
        trip_meta
      `, { count: "exact" })
      .eq("visibility", "public")
      .not("share_token", "is", null)
      .not("submitted_to_trending_at", "is", null)
      .order("trending_score", { ascending: false })
      .order("shared_at", { ascending: false });

    // Apply filters
    if (destination) {
      // Search in trip_meta.destination or title
      query = query.or(`title.ilike.%${destination}%,trip_meta->destination.ilike.%${destination}%`);
    }

    if (durationMin) {
      // Filter by duration (end_date - start_date)
      // This requires raw SQL, so we'll filter post-fetch for simplicity
    }

    if (budgetTier) {
      query = query.eq("trip_meta->budget_tier", budgetTier);
    }

    if (tags && tags.length > 0) {
      query = query.contains("tags", tags);
    }

    // Pagination
    const start = (page - 1) * perPage;
    query = query.range(start, start + perPage - 1);

    const { data: trips, error, count } = await query;

    if (error) {
      console.error("[Explore API] Query error:", error);
      return NextResponse.json(
        { error: "Failed to fetch trips" },
        { status: 500 }
      );
    }

    // Post-process trips to extract relevant info
    const processedTrips = (trips || []).map((trip) => {
      const startDate = new Date(trip.start_date);
      const endDate = new Date(trip.end_date);
      const durationDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

      // Get cover image from first activity or trip_meta
      let coverImage = trip.cover_image_url;
      if (!coverImage && trip.itinerary) {
        const itinerary = trip.itinerary as Array<{ activities?: Array<{ image?: string }> }>;
        for (const day of itinerary) {
          if (day.activities) {
            for (const activity of day.activities) {
              if (activity.image) {
                coverImage = activity.image;
                break;
              }
            }
            if (coverImage) break;
          }
        }
      }

      const meta = trip.trip_meta as Record<string, unknown> || {};

      return {
        id: trip.id,
        title: trip.title,
        description: trip.description,
        shareToken: trip.share_token,
        destination: meta.destination || trip.title,
        countryCode: meta.country_code as string || null,
        durationDays,
        coverImage,
        tags: trip.tags || [],
        budgetTier: meta.budget_tier || "balanced",
        trendingScore: trip.trending_score,
        viewCount: trip.view_count || 0,
        copyCount: trip.template_copy_count || 0,
        sharedAt: trip.shared_at,
      };
    });

    // Apply duration filter post-fetch if needed
    let filteredTrips = processedTrips;
    if (durationMin) {
      filteredTrips = filteredTrips.filter(t => t.durationDays >= parseInt(durationMin));
    }
    if (durationMax) {
      filteredTrips = filteredTrips.filter(t => t.durationDays <= parseInt(durationMax));
    }

    return NextResponse.json({
      trips: filteredTrips,
      total: count || 0,
      page,
      perPage,
      totalPages: Math.ceil((count || 0) / perPage),
    });
  } catch (error) {
    console.error("[Explore API] Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
