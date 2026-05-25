import { createClient } from "@/lib/supabase/server";
import { NextRequest } from "next/server";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { isExploreUgcEnabled } from "@/lib/explore/flag";

/**
 * GET /api/explore/trips
 * Returns trending public trips with optional filters.
 *
 * **2026-05-25 (Week 1 of /explore UGC build)**: extended the response
 * to include author info + engagement counts (likes/saves/forks) +
 * Editor's Picks flag. NOTE: this GET is intentionally NOT gated by
 * EXPLORE_UGC_ENABLED — the existing /explore page (template/featured
 * trips) is already live + indexed and shouldn't 404 during the rollout
 * window. Only the WRITE endpoints (like/save/fork/publish/report) are
 * env-flag-gated.
 */
export async function GET(request: NextRequest) {
  // Mark the import as used even when the gate is removed — keeps the
  // import-cleanup pass from removing it (we may flag the GET later if
  // the catalog grows abuse-prone).
  void isExploreUgcEnabled;

  try {
    const { searchParams } = new URL(request.url);

    // Parse filters
    const destination = searchParams.get("destination");
    const durationMin = searchParams.get("duration_min");
    const durationMax = searchParams.get("duration_max");
    const budgetTier = searchParams.get("budget");
    const tags = searchParams.get("tags")?.split(",").filter(Boolean);
    // Bug-bounty 2026-05-24 P1: parseInt of arbitrary strings produces
    // NaN which then flowed into query.range(NaN, NaN) — undefined
    // Supabase behaviour. Clamp + default.
    const rawPage = parseInt(searchParams.get("page") || "1", 10);
    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
    const rawPerPage = parseInt(searchParams.get("per_page") || "12", 10);
    const perPage = Math.min(
      Number.isFinite(rawPerPage) && rawPerPage > 0 ? rawPerPage : 12,
      50
    );

    const supabase = await createClient();

    // Build query — now includes the new engagement + author columns
    // shipped in migration 20260525_explore_ugc_feed.sql.
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
        trip_meta,
        like_count,
        save_count,
        fork_count,
        author_display_name,
        author_note,
        is_editors_pick
      `, { count: "exact" })
      .eq("visibility", "public")
      .eq("is_hidden", false)
      .not("share_token", "is", null)
      .not("submitted_to_trending_at", "is", null)
      .order("trending_score", { ascending: false })
      .order("shared_at", { ascending: false });

    // Apply filters
    if (destination) {
      // Bug-bounty 2026-05-24 P1: previously concatenated `destination`
      // straight into the PostgREST .or() string. Commas, parens, quotes
      // in the user-supplied value broke the filter or allowed abusing
      // operators. Escape PostgREST-special characters (parens, commas,
      // colons, periods that follow operators) before interpolation.
      const escaped = destination.replace(/[(),:]/g, "\\$&");
      query = query.or(`title.ilike.%${escaped}%,trip_meta->destination.ilike.%${escaped}%`);
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
      console.error("[Explore] Query error:", error);
      return errors.internal("Failed to fetch trips", "Explore");
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
        // copyCount kept for backward compat; forkCount is the new
        // primary signal for UGC.
        copyCount: trip.template_copy_count || 0,
        likeCount: trip.like_count || 0,
        saveCount: trip.save_count || 0,
        forkCount: trip.fork_count || 0,
        author: {
          displayName: trip.author_display_name || "Anonymous traveler",
        },
        authorNote: trip.author_note || null,
        isEditorsPick: !!trip.is_editors_pick,
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

    return apiSuccess({
      trips: filteredTrips,
      total: count || 0,
      page,
      perPage,
      totalPages: Math.ceil((count || 0) / perPage),
    });
  } catch (error) {
    console.error("[Explore] Unexpected error:", error);
    return errors.internal("Internal server error", "Explore");
  }
}
