/**
 * API Configuration Admin Endpoint
 *
 * GET - Retrieve all API configurations
 * PATCH - Update API configuration (enable/disable, change block mode)
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import { invalidateConfigCache } from "@/lib/api-gateway";

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
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check admin access
    if (!isAdmin(user.email)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Fetch all API configs
    const { data, error } = await supabase
      .from("api_config")
      .select("*")
      .order("category", { ascending: true })
      .order("display_name", { ascending: true });

    if (error) {
      console.error("[ApiConfig] Failed to fetch:", error);
      return NextResponse.json(
        { error: "Failed to fetch API configurations" },
        { status: 500 }
      );
    }

    return NextResponse.json({ configs: data || [] });
  } catch (error) {
    console.error("[ApiConfig] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
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
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check admin access
    if (!isAdmin(user.email)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Parse request body
    const body = await request.json();
    const { api_name, enabled, block_mode, daily_limit, monthly_limit } = body;

    if (!api_name) {
      return NextResponse.json(
        { error: "api_name is required" },
        { status: 400 }
      );
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
      console.error("[ApiConfig] Failed to update:", error);
      return NextResponse.json(
        { error: "Failed to update API configuration" },
        { status: 500 }
      );
    }

    // Invalidate the config cache so changes take effect immediately
    invalidateConfigCache();

    console.log(`[ApiConfig] Updated ${api_name}:`, updates);

    return NextResponse.json({
      success: true,
      config: data,
      message: `${data.display_name} configuration updated`,
    });
  } catch (error) {
    console.error("[ApiConfig] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
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
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check admin access
    if (!isAdmin(user.email)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
        return NextResponse.json({ error: "Failed to reset" }, { status: 500 });
      }

      invalidateConfigCache();
      return NextResponse.json({ success: true, message: "Daily counter reset" });
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
        return NextResponse.json({ error: "Failed to reset" }, { status: 500 });
      }

      invalidateConfigCache();
      return NextResponse.json({ success: true, message: "Monthly counter reset" });
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
        return NextResponse.json({ error: "Failed to enable all" }, { status: 500 });
      }

      invalidateConfigCache();
      return NextResponse.json({ success: true, message: "All APIs enabled" });
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
        return NextResponse.json({ error: "Failed to disable all" }, { status: 500 });
      }

      invalidateConfigCache();
      return NextResponse.json({ success: true, message: "All APIs disabled" });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("[ApiConfig] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
