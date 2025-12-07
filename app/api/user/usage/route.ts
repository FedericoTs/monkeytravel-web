/**
 * User Usage API Route
 *
 * GET /api/user/usage
 *
 * Returns the current user's usage statistics and limits.
 * Used for the dashboard and upgrade prompts.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserUsageStats } from "@/lib/usage-limits";

export async function GET() {
  try {
    // Check authentication
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get full usage stats
    const stats = await getUserUsageStats(user.id, user.email);

    return NextResponse.json({
      success: true,
      usage: stats,
    });
  } catch (error) {
    console.error("Error fetching user usage:", error);
    return NextResponse.json(
      { error: "Failed to fetch usage data" },
      { status: 500 }
    );
  }
}
