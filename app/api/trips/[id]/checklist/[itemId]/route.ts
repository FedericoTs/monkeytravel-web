import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import type { TripChecklistItemRouteContext } from "@/lib/api/route-context";

/**
 * PATCH /api/trips/[id]/checklist/[itemId] - Update a checklist item
 */
export async function PATCH(request: NextRequest, context: TripChecklistItemRouteContext) {
  try {
    const { id: tripId, itemId } = await context.params;
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return errors.unauthorized();
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
      return errors.notFound("Item not found");
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
        return errors.badRequest("Text cannot be empty");
      }
      updates.text = body.text.trim();
    }

    // Handle category update
    if (body.category !== undefined) {
      const validCategories = ["booking", "packing", "document", "custom"];
      if (!validCategories.includes(body.category)) {
        return errors.badRequest("Invalid category");
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
      return errors.badRequest("No valid fields to update");
    }

    // Update item
    const { data: item, error } = await supabase
      .from("trip_checklists")
      .update(updates)
      .eq("id", itemId)
      .select()
      .single();

    if (error) {
      console.error("[Checklist] Error updating item:", error);
      return errors.internal("Failed to update checklist item", "Checklist");
    }

    return apiSuccess({ success: true, item });
  } catch (error) {
    console.error("[Checklist] Unexpected error in PATCH:", error);
    return errors.internal("Failed to update checklist item", "Checklist");
  }
}

/**
 * DELETE /api/trips/[id]/checklist/[itemId] - Delete a checklist item
 */
export async function DELETE(request: NextRequest, context: TripChecklistItemRouteContext) {
  try {
    const { id: tripId, itemId } = await context.params;
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return errors.unauthorized();
    }

    // Delete item (RLS will ensure ownership)
    const { error } = await supabase
      .from("trip_checklists")
      .delete()
      .eq("id", itemId)
      .eq("trip_id", tripId)
      .eq("user_id", user.id);

    if (error) {
      console.error("[Checklist] Error deleting item:", error);
      return errors.internal("Failed to delete checklist item", "Checklist");
    }

    return apiSuccess({ success: true });
  } catch (error) {
    console.error("[Checklist] Unexpected error in DELETE:", error);
    return errors.internal("Failed to delete checklist item", "Checklist");
  }
}
