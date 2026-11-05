import { getAuthenticatedAdmin } from "@/lib/api/auth";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { createAdminClient } from "@/lib/supabase/admin";
import { readGrowthRows } from "@/lib/admin/growth/rows";
import { computeGrowthStats } from "@/lib/admin/growth/stats";

export async function GET() {
  try {
    // Auth + admin gate via user-context client (RLS-respecting).
    const { errorResponse } = await getAuthenticatedAdmin();
    if (errorResponse) return errorResponse;
    // Then the service role for cross-user reads: under RLS every count would
    // silently cover only the admin's own rows.
    const { rows, dataWarnings } = await readGrowthRows(createAdminClient());
    return apiSuccess(computeGrowthStats(rows, dataWarnings, new Date()));
  } catch (error) {
    console.error("[Admin Growth] Error:", error);
    return errors.internal("Failed to fetch growth stats", "Admin Growth");
  }
}
