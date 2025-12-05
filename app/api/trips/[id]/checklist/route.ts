import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/trips/[id]/checklist - Fetch checklist items for a trip
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id: tripId } = await context.params;
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify trip ownership
    const { data: trip, error: tripError } = await supabase
      .from("trips")
      .select("id")
      .eq("id", tripId)
      .eq("user_id", user.id)
      .single();

    if (tripError || !trip) {
      return NextResponse.json({ error: "Trip not found" }, { status: 404 });
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
      console.error("Error fetching checklist:", error);
      return NextResponse.json(
        { error: "Failed to fetch checklist" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, items: items || [] });
  } catch (error) {
    console.error("Error fetching checklist:", error);
    return NextResponse.json(
      { error: "Failed to fetch checklist" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/trips/[id]/checklist - Add a checklist item
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id: tripId } = await context.params;
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify trip ownership
    const { data: trip, error: tripError } = await supabase
      .from("trips")
      .select("id")
      .eq("id", tripId)
      .eq("user_id", user.id)
      .single();

    if (tripError || !trip) {
      return NextResponse.json({ error: "Trip not found" }, { status: 404 });
    }

    // Parse request body
    const body = await request.json();
    const { text, category = "custom", due_date, source_activity_id } = body;

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return NextResponse.json(
        { error: "Text is required" },
        { status: 400 }
      );
    }

    // Validate category
    const validCategories = ["booking", "packing", "document", "custom"];
    if (!validCategories.includes(category)) {
      return NextResponse.json(
        { error: "Invalid category" },
        { status: 400 }
      );
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
      console.error("Error creating checklist item:", error);
      return NextResponse.json(
        { error: "Failed to create checklist item" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, item }, { status: 201 });
  } catch (error) {
    console.error("Error creating checklist item:", error);
    return NextResponse.json(
      { error: "Failed to create checklist item" },
      { status: 500 }
    );
  }
}
