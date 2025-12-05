import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";

export interface SiteConfig {
  id: number;
  maintenance_mode: boolean;
  maintenance_message: string;
  maintenance_title: string;
  maintenance_started_at: string | null;
  allowed_emails: string[];
  updated_at: string;
  updated_by: string | null;
}

/**
 * GET /api/admin/config - Get current site configuration
 * Public endpoint (needed for maintenance check)
 */
export async function GET() {
  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("site_config")
      .select("*")
      .eq("id", 1)
      .single();

    if (error) {
      console.error("Error fetching site config:", error);
      // Return default config if table doesn't exist or is empty
      return NextResponse.json({
        maintenance_mode: false,
        maintenance_message: "We are currently performing scheduled maintenance.",
        maintenance_title: "Under Maintenance",
        allowed_emails: [],
      });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Site config error:", error);
    return NextResponse.json(
      { error: "Failed to fetch site config" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/admin/config - Update site configuration
 * Admin only endpoint
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

    const body = await request.json();
    const updates: Record<string, unknown> = {
      updated_by: user.id,
    };

    // Handle maintenance_mode toggle
    if (typeof body.maintenance_mode === "boolean") {
      updates.maintenance_mode = body.maintenance_mode;

      // Set or clear maintenance_started_at
      if (body.maintenance_mode) {
        updates.maintenance_started_at = new Date().toISOString();
      } else {
        updates.maintenance_started_at = null;
      }
    }

    // Handle maintenance_message
    if (typeof body.maintenance_message === "string") {
      updates.maintenance_message = body.maintenance_message.trim();
    }

    // Handle maintenance_title
    if (typeof body.maintenance_title === "string") {
      updates.maintenance_title = body.maintenance_title.trim();
    }

    // Handle allowed_emails
    if (Array.isArray(body.allowed_emails)) {
      // Validate and normalize email list
      const validEmails = body.allowed_emails
        .filter((e: unknown) => typeof e === "string" && e.includes("@"))
        .map((e: string) => e.toLowerCase().trim());
      updates.allowed_emails = validEmails;
    }

    // Update the config
    const { data, error } = await supabase
      .from("site_config")
      .update(updates)
      .eq("id", 1)
      .select()
      .single();

    if (error) {
      console.error("Error updating site config:", error);
      return NextResponse.json(
        { error: "Failed to update site config" },
        { status: 500 }
      );
    }

    // Log the action
    console.log(`[Admin] Site config updated by ${user.email}:`, {
      maintenance_mode: data.maintenance_mode,
      updated_at: data.updated_at,
    });

    return NextResponse.json({
      success: true,
      config: data,
    });
  } catch (error) {
    console.error("Site config update error:", error);
    return NextResponse.json(
      { error: "Failed to update site config" },
      { status: 500 }
    );
  }
}
