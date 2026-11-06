import { getAuthenticatedAdmin } from "@/lib/api/auth";
import { apiSuccess, errors } from "@/lib/api/response-wrapper";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/admin/config/access - The whole site config for the Access tab, with who
 * may pass during maintenance. Admin only, and never kept by a cache.
 */
export async function GET() {
  const { errorResponse } = await getAuthenticatedAdmin();
  if (errorResponse) return errorResponse;

  try {
    const { data, error } = await createAdminClient().from("site_config").select("*").eq("id", 1).single();
    if (error || !data) {
      console.error("[Admin Config] Error fetching the access list:", error);
      return errors.internal("Failed to fetch site config", "Admin Config");
    }
    return apiSuccess(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[Admin Config] Access list error:", error);
    return errors.internal("Failed to fetch site config", "Admin Config");
  }
}
