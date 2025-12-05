import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface RouteContext {
  params: Promise<{ id: string; itemId: string }>;
}

/**
 * PATCH /api/trips/[id]/checklist/[itemId] - Update a checklist item
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id: tripId, itemId } = await context.params;
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify item ownership
    const { data: existingItem, error: fetchError } = await supabase
      .from("trip_checklists")
      .select("*")
      .eq("id", itemId)
      .eq("trip_id", tripId)
      .eq("user_id", user.id)
      .single();

    if (fetchError || !existingItem) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }

    // Parse request body
    const body = await request.json();
    const updates: Record<string, unknown> = {};

    // Handle toggleable fields
    if (body.is_checked !== undefined) {
      updates.is_checked = Boolean(body.is_checked);
      updates.checked_at = body.is_checked ? new Date().toISOString() : null;
    }

    // Handle text update
    if (body.text !== undefined) {
      if (typeof body.text !== "string" || body.text.trim().length === 0) {
        return NextResponse.json(
          { error: "Text cannot be empty" },
          { status: 400 }
        );
      }
      updates.text = body.text.trim();
    }

    // Handle category update
    if (body.category !== undefined) {
      const validCategories = ["booking", "packing", "document", "custom"];
      if (!validCategories.includes(body.category)) {
        return NextResponse.json(
          { error: "Invalid category" },
          { status: 400 }
        );
      }
      updates.category = body.category;
    }

    // Handle due_date update
    if (body.due_date !== undefined) {
      updates.due_date = body.due_date || null;
    }

    // Handle sort_order update
    if (body.sort_order !== undefined) {
      updates.sort_order = Number(body.sort_order);
    }

    // Check if there's anything to update
    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    // Update item
    const { data: item, error } = await supabase
      .from("trip_checklists")
      .update(updates)
      .eq("id", itemId)
      .select()
      .single();

    if (error) {
      console.error("Error updating checklist item:", error);
      return NextResponse.json(
        { error: "Failed to update checklist item" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, item });
  } catch (error) {
    console.error("Error updating checklist item:", error);
    return NextResponse.json(
      { error: "Failed to update checklist item" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/trips/[id]/checklist/[itemId] - Delete a checklist item
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { id: tripId, itemId } = await context.params;
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Delete item (RLS will ensure ownership)
    const { error } = await supabase
      .from("trip_checklists")
      .delete()
      .eq("id", itemId)
      .eq("trip_id", tripId)
      .eq("user_id", user.id);

    if (error) {
      console.error("Error deleting checklist item:", error);
      return NextResponse.json(
        { error: "Failed to delete checklist item" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting checklist item:", error);
    return NextResponse.json(
      { error: "Failed to delete checklist item" },
      { status: 500 }
    );
  }
}
