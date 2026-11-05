import { getAuthenticatedAdmin } from "@/lib/api/auth";
import { circuitBreakerManager } from "@/lib/api-gateway";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { computeCostAnalytics } from "@/lib/admin/costs/analytics";
import { readCostRows } from "@/lib/admin/costs/rows";

export async function GET() {
  try {
    const { errorResponse } = await getAuthenticatedAdmin();
    if (errorResponse) return errorResponse;
    // Admin identity is an allowlist in lib/admin.ts, checked above: Postgres knows
    // nothing about it, so the read below uses the service role, past that gate.
    const now = new Date();
    const rows = await readCostRows(now);
    return apiSuccess(computeCostAnalytics(rows, circuitBreakerManager.getAllStats(), now));
  } catch (error) {
    console.error("[Admin Costs] Error:", error);
    return errors.internal("Failed to fetch cost analytics", "Admin Costs");
  }
}
