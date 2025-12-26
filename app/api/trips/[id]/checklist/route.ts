import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import type { TripRouteContext } from "@/lib/api/route-context";

/**
 * GET /api/trips/[id]/checklist - Fetch checklist items for a trip
 */
export async function GET(request: NextRequest, context: TripRouteContext) {
  try {
    const { id: tripId } = await context.params;
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return errors.unauthorized();
    }

    // Verify trip ownership
    const { data: trip, error: tripError } = await supabase
      .from("trips")
      .select("id")
      .eq("id", tripId)
      .eq("user_id", user.id)
      .single();

    if (tripError || !trip) {
      return errors.notFound("Trip not found");
    }

    // Fetch checklist items
    const { data: items, error } = await supabase
      .from("trip_checklists")
      .select("*")
      .eq("trip_id", tripId)
      .eq("user_id", user.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[Checklist] Error fetching:", error);
      return errors.internal("Failed to fetch checklist", "Checklist");
    }

    return apiSuccess({ success: true, items: items || [] });
  } catch (error) {
    console.error("[Checklist] Unexpected error in GET:", error);
    return errors.internal("Failed to fetch checklist", "Checklist");
  }
}

/**
 * POST /api/trips/[id]/checklist - Add a checklist item
 */
export async function POST(request: NextRequest, context: TripRouteContext) {
  try {
    const { id: tripId } = await context.params;
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return errors.unauthorized();
    }

    // Verify trip ownership
    const { data: trip, error: tripError } = await supabase
      .from("trips")
      .select("id")
      .eq("id", tripId)
      .eq("user_id", user.id)
      .single();

    if (tripError || !trip) {
      return errors.notFound("Trip not found");
    }

    // Parse request body
    const body = await request.json();
    const { text, category = "custom", due_date, source_activity_id } = body;

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return errors.badRequest("Text is required");
    }

    // Validate category
    const validCategories = ["booking", "packing", "document", "custom"];
    if (!validCategories.includes(category)) {
      return errors.badRequest("Invalid category");
    }

    // Get max sort_order for this trip
    const { data: maxOrderItem } = await supabase
      .from("trip_checklists")
      .select("sort_order")
      .eq("trip_id", tripId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .single();

    const sortOrder = (maxOrderItem?.sort_order || 0) + 1;

    // Insert checklist item
    const { data: item, error } = await supabase
      .from("trip_checklists")
      .insert({
        trip_id: tripId,
        user_id: user.id,
        text: text.trim(),
        category,
        due_date: due_date || null,
        source_activity_id: source_activity_id || null,
        sort_order: sortOrder,
      })
      .select()
      .single();

    if (error) {
      console.error("[Checklist] Error creating item:", error);
      return errors.internal("Failed to create checklist item", "Checklist");
    }

    return apiSuccess({ success: true, item }, { status: 201 });
  } catch (error) {
    console.error("[Checklist] Unexpected error in POST:", error);
    return errors.internal("Failed to create checklist item", "Checklist");
  }
}
