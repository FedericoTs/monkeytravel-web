import { NextRequest } from "next/server";
import { dangerouslyDeleteByTag } from "@vercel/functions";
import { getAuthenticatedAdmin } from "@/lib/api/auth";
import { createClient } from "@/lib/supabase/server";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { readJsonBody } from "@/lib/api/json-body";

/** The CDN tag on the public config, so a change can drop the kept copy. */
const SITE_CONFIG_TAG = "site-config";

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
      console.error("[Admin Config] Error fetching site config:", error);
      // Return default config if table doesn't exist or is empty
      return apiSuccess({
        maintenance_mode: false,
        maintenance_message: "We are currently performing scheduled maintenance.",
        maintenance_title: "Under Maintenance",
      });
    }

    // Public response: only expose maintenance info, never allowed_emails.
    // Cache at the edge: maintenance toggles are rare, and PATCH drops the kept
    // copy. Without this header every visitor's first request re-queries Supabase.
    return apiSuccess(
      {
        maintenance_mode: data.maintenance_mode,
        maintenance_message: data.maintenance_message,
        maintenance_title: data.maintenance_title,
        maintenance_started_at: data.maintenance_started_at,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600",
          "Vercel-Cache-Tag": SITE_CONFIG_TAG,
        },
      },
    );
  } catch (error) {
    console.error("[Admin Config] Site config error:", error);
    return errors.internal("Failed to fetch site config", "Admin Config");
  }
}

/**
 * PATCH /api/admin/config - Update site configuration
 * Admin only endpoint
 */
export async function PATCH(request: NextRequest) {
  try {
    const { user, supabase, errorResponse } = await getAuthenticatedAdmin();
    if (errorResponse) return errorResponse;

    const { body, invalidBody } = await readJsonBody(request);
    if (invalidBody) return invalidBody;
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
      console.error("[Admin Config] Error updating site config:", error);
      return errors.internal("Failed to update site config", "Admin Config");
    }

    await dangerouslyDeleteByTag(SITE_CONFIG_TAG).catch((err: unknown) => {
      console.error("[Admin Config] CDN copy not dropped:", err);
    });

    // Log the action
    console.log(`[Admin Config] Site config updated by ${user.email}:`, {
      maintenance_mode: data.maintenance_mode,
      updated_at: data.updated_at,
    });

    return apiSuccess({
      success: true,
      config: data,
    });
  } catch (error) {
    console.error("[Admin Config] Site config update error:", error);
    return errors.internal("Failed to update site config", "Admin Config");
  }
}
