/**
 * User Usage API Route
 *
 * GET /api/user/usage
 *
 * Returns the current user's usage statistics and limits.
 * Used for the dashboard and upgrade prompts.
 */

import { getUserUsageStats } from "@/lib/usage-limits";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { getAuthenticatedUser } from "@/lib/api/auth";

export async function GET() {
  try {
    const { user, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // Get full usage stats
    const stats = await getUserUsageStats(user.id, user.email);

    return apiSuccess({ success: true, usage: stats });
  } catch (error) {
    console.error("[Usage] Error fetching user usage:", error);
    return errors.internal("Failed to fetch usage data", "Usage");
  }
}
