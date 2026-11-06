/**
 * API Configuration Admin Endpoint
 *
 * GET - Retrieve all API configurations
 * PATCH - Update API configuration (enable/disable, change block mode, daily limit)
 * POST - Stop every API at once
 */

import { NextRequest } from "next/server";
import { getAuthenticatedAdmin } from "@/lib/api/auth";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { readJsonBody } from "@/lib/api/json-body";

export interface ApiConfig {
  id: string;
  api_name: string;
  display_name: string;
  description: string | null;
  enabled: boolean;
  block_mode: "none" | "block_calls" | "block_keys" | "maintenance";
  category: string;
  cost_per_request: number;
  daily_limit: number | null;
  updated_at: string;
}

/**
 * GET /api/admin/api-config
 * Retrieve all API configurations
 */
export async function GET() {
  try {
    const { supabase, errorResponse } = await getAuthenticatedAdmin();
    if (errorResponse) return errorResponse;

    // Fetch all API configs
    const { data, error } = await supabase
      .from("api_config")
      .select("*")
      .order("category", { ascending: true })
      .order("display_name", { ascending: true });

    if (error) {
      console.error("[Admin ApiConfig] Failed to fetch:", error);
      return errors.internal("Failed to fetch API configurations", "Admin ApiConfig");
    }

    return apiSuccess({ configs: data || [] });
  } catch (error) {
    console.error("[Admin ApiConfig] GET error:", error);
    return errors.internal("Internal server error", "Admin ApiConfig");
  }
}

/**
 * PATCH /api/admin/api-config
 * Update an API configuration
 */
export async function PATCH(request: NextRequest) {
  try {
    const { user, supabase, errorResponse } = await getAuthenticatedAdmin();
    if (errorResponse) return errorResponse;

    // Parse request body
    const { body, invalidBody } = await readJsonBody(request);
    if (invalidBody) return invalidBody;
    const { api_name, enabled, block_mode, daily_limit } = body;

    if (!api_name) {
      return errors.badRequest("api_name is required");
    }

    if (daily_limit !== undefined && daily_limit !== null && !(Number.isSafeInteger(daily_limit) && daily_limit >= 0)) {
      return errors.badRequest("daily_limit must be a whole number, 0 or more, or null");
    }

    // Build update object
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    };

    if (typeof enabled === "boolean") {
      updates.enabled = enabled;
    }

    if (block_mode && ["none", "block_calls", "block_keys", "maintenance"].includes(block_mode)) {
      updates.block_mode = block_mode;
    }

    if (daily_limit !== undefined) {
      updates.daily_limit = daily_limit;
    }

    // Update the API config
    const { data, error } = await supabase
      .from("api_config")
      .update(updates)
      .eq("api_name", api_name)
      .select()
      .single();

    if (error) {
      console.error("[Admin ApiConfig] Failed to update:", error);
      return errors.internal("Failed to update API configuration", "Admin ApiConfig");
    }

    console.log(`[Admin ApiConfig] Updated ${api_name}:`, updates);

    return apiSuccess({
      success: true,
      config: data,
      message: `${data.display_name} configuration updated`,
    });
  } catch (error) {
    console.error("[Admin ApiConfig] PATCH error:", error);
    return errors.internal("Internal server error", "Admin ApiConfig");
  }
}

/**
 * POST /api/admin/api-config
 * Stop every API at once. There's no way back in one step on purpose: some paid
 * APIs are off for good reasons, so each goes back on by its own switch.
 */
export async function POST(request: NextRequest) {
  try {
    const { user, supabase, errorResponse } = await getAuthenticatedAdmin();
    if (errorResponse) return errorResponse;

    const { body, invalidBody } = await readJsonBody(request);
    if (invalidBody) return invalidBody;

    if (body.action === "disable_all") {
      const { error } = await supabase
        .from("api_config")
        .update({
          enabled: false,
          block_mode: "block_calls",
          updated_at: new Date().toISOString(),
          updated_by: user.id,
        })
        // PostgREST refuses an update with no filter.
        .neq("api_name", "");

      if (error) {
        console.error("[Admin ApiConfig] Failed to disable all:", error);
        return errors.internal("Failed to disable all APIs", "Admin ApiConfig");
      }

      return apiSuccess({ success: true, message: "All APIs disabled" });
    }

    return errors.badRequest("Invalid action");
  } catch (error) {
    console.error("[Admin ApiConfig] POST error:", error);
    return errors.internal("Internal server error", "Admin ApiConfig");
  }
}
