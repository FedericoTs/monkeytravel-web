import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";

/**
 * Escape special characters for PostgREST ilike queries
 */
function escapeForPostgrest(input: string): string {
  return input
    .replace(/[%_]/g, "\\$&")
    .replace(/[,.()\[\]{}]/g, "")
    .replace(/'/g, "''");
}

/**
 * GET /api/templates
 *
 * Fetch template trips with optional filters
 *
 * Query params:
 * - mood: string[] - Filter by mood tags (comma-separated)
 * - duration: number - Filter by duration (7, 10, 14)
 * - budget: string - Filter by budget tier (budget, moderate, luxury)
 * - destination: string - Search by destination name
 * - featured: boolean - Only show featured templates
 * - limit: number - Max results (default 20)
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const searchParams = request.nextUrl.searchParams;

    // Parse query parameters
    const moods = searchParams.get("mood")?.split(",").filter(Boolean) || [];
    const duration = searchParams.get("duration")
      ? parseInt(searchParams.get("duration")!)
      : null;
    const budget = searchParams.get("budget");
    const destination = searchParams.get("destination");
    const featured = searchParams.get("featured") === "true";
    const limit = parseInt(searchParams.get("limit") || "20");

    // Build query
    let query = supabase
      .from("trips")
      .select(`
        id,
        title,
        description,
        start_date,
        end_date,
        status,
        cover_image_url,
        tags,
        budget,
        itinerary,
        trip_meta,
        packing_list,
        is_template,
        template_mood_tags,
        template_duration_days,
        template_budget_tier,
        template_destination,
        template_country,
        template_country_code,
        template_featured_order,
        template_copy_count,
        template_short_description
      `)
      .eq("is_template", true)
      .eq("visibility", "public")
      .order("template_featured_order", { ascending: true, nullsFirst: false })
      .order("template_copy_count", { ascending: false })
      .limit(limit);

    // Apply mood filter (any mood matches)
    if (moods.length > 0) {
      query = query.overlaps("template_mood_tags", moods);
    }

    // Apply duration filter
    if (duration) {
      query = query.eq("template_duration_days", duration);
    }

    // Apply budget filter
    if (budget && ["budget", "moderate", "luxury"].includes(budget)) {
      query = query.eq("template_budget_tier", budget);
    }

    // Apply destination search (case-insensitive partial match)
    if (destination) {
      const escapedDest = escapeForPostgrest(destination.toLowerCase().trim());
      query = query.or(
        `template_destination.ilike.%${escapedDest}%,template_country.ilike.%${escapedDest}%`
      );
    }

    // Only featured templates
    if (featured) {
      query = query.not("template_featured_order", "is", null);
    }

    const { data: templates, error } = await query;

    if (error) {
      console.error("[Templates] Error fetching templates:", error);
      return errors.internal("Failed to fetch templates", "Templates");
    }

    // Transform data for frontend
    const formattedTemplates = (templates || []).map((template) => ({
      id: template.id,
      title: template.title,
      description: template.template_short_description || template.description,
      destination: template.template_destination,
      country: template.template_country,
      countryCode: template.template_country_code,
      coverImageUrl: template.cover_image_url,
      durationDays: template.template_duration_days,
      budgetTier: template.template_budget_tier,
      moodTags: template.template_mood_tags || [],
      tags: template.tags || [],
      copyCount: template.template_copy_count || 0,
      featuredOrder: template.template_featured_order,
      // Include full data for preview/copy
      itinerary: template.itinerary,
      meta: template.trip_meta,
      budget: template.budget,
      packingList: template.packing_list,
    }));

    return apiSuccess({
      templates: formattedTemplates,
      count: formattedTemplates.length,
    });
  } catch (error) {
    console.error("[Templates] Unexpected error:", error);
    return errors.internal("Internal server error", "Templates");
  }
}
