/**
 * API Configuration Admin Endpoint
 *
 * GET - Retrieve all API configurations
 * PATCH - Update API configuration (enable/disable, change block mode)
 */

import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import { invalidateConfigCache } from "@/lib/api-gateway";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";

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
  monthly_limit: number | null;
  current_daily_count: number;
  current_monthly_count: number;
  updated_at: string;
}

/**
 * GET /api/admin/api-config
 * Retrieve all API configurations
 */
export async function GET() {
  try {
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return errors.unauthorized();
    }

    // Check admin access
    if (!isAdmin(user.email)) {
      return errors.forbidden();
    }

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
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return errors.unauthorized();
    }

    // Check admin access
    if (!isAdmin(user.email)) {
      return errors.forbidden();
    }

    // Parse request body
    const body = await request.json();
    const { api_name, enabled, block_mode, daily_limit, monthly_limit } = body;

    if (!api_name) {
      return errors.badRequest("api_name is required");
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

    if (typeof daily_limit === "number" || daily_limit === null) {
      updates.daily_limit = daily_limit;
    }

    if (typeof monthly_limit === "number" || monthly_limit === null) {
      updates.monthly_limit = monthly_limit;
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

    // Invalidate the config cache so changes take effect immediately
    invalidateConfigCache();

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
 * POST /api/admin/api-config/reset-counters
 * Reset daily/monthly counters (for testing)
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return errors.unauthorized();
    }

    // Check admin access
    if (!isAdmin(user.email)) {
      return errors.forbidden();
    }

    const body = await request.json();
    const { action, api_name } = body;

    if (action === "reset_daily") {
      const { error } = await supabase
        .from("api_config")
        .update({
          current_daily_count: 0,
          last_reset_daily: new Date().toISOString(),
        })
        .eq("api_name", api_name || "");

      if (error) {
        return errors.internal("Failed to reset daily counter", "Admin ApiConfig");
      }

      invalidateConfigCache();
      return apiSuccess({ success: true, message: "Daily counter reset" });
    }

    if (action === "reset_monthly") {
      const { error } = await supabase
        .from("api_config")
        .update({
          current_monthly_count: 0,
          last_reset_monthly: new Date().toISOString(),
        })
        .eq("api_name", api_name || "");

      if (error) {
        return errors.internal("Failed to reset monthly counter", "Admin ApiConfig");
      }

      invalidateConfigCache();
      return apiSuccess({ success: true, message: "Monthly counter reset" });
    }

    if (action === "enable_all") {
      const { error } = await supabase
        .from("api_config")
        .update({
          enabled: true,
          block_mode: "none",
          updated_at: new Date().toISOString(),
          updated_by: user.id,
        });

      if (error) {
        return errors.internal("Failed to enable all APIs", "Admin ApiConfig");
      }

      invalidateConfigCache();
      return apiSuccess({ success: true, message: "All APIs enabled" });
    }

    if (action === "disable_all") {
      const { error } = await supabase
        .from("api_config")
        .update({
          enabled: false,
          block_mode: "block_calls",
          updated_at: new Date().toISOString(),
          updated_by: user.id,
        });

      if (error) {
        return errors.internal("Failed to disable all APIs", "Admin ApiConfig");
      }

      invalidateConfigCache();
      return apiSuccess({ success: true, message: "All APIs disabled" });
    }

    return errors.badRequest("Invalid action");
  } catch (error) {
    console.error("[Admin ApiConfig] POST error:", error);
    return errors.internal("Internal server error", "Admin ApiConfig");
  }
}
