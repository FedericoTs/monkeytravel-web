import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/templates/[id]
 *
 * Fetch a single template trip by ID
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { id: templateId } = await params;

    const { data: template, error } = await supabase
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
      .eq("id", templateId)
      .eq("is_template", true)
      .eq("visibility", "public")
      .single();

    if (error || !template) {
      return NextResponse.json(
        { error: "Template not found" },
        { status: 404 }
      );
    }

    // Transform data for frontend
    const formattedTemplate = {
      id: template.id,
      title: template.title,
      description: template.template_short_description || template.description,
      fullDescription: template.description,
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
      // Full trip data for preview
      itinerary: template.itinerary,
      meta: template.trip_meta,
      budget: template.budget,
      packingList: template.packing_list,
      // Dates (these are placeholder, will be adjusted on copy)
      startDate: template.start_date,
      endDate: template.end_date,
    };

    return NextResponse.json({ template: formattedTemplate });
  } catch (error) {
    console.error("[Template API] Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
