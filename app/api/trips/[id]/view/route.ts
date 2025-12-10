import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";

/**
 * POST /api/trips/[id]/view
 * Records a view for a trip
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { source } = await request.json();

    const supabase = await createClient();
    const headersList = await headers();

    // Get current user (optional)
    const { data: { user } } = await supabase.auth.getUser();

    // Generate session ID for deduplication
    // Use a combination of IP + user agent + timestamp bucket (hourly)
    const forwarded = headersList.get("x-forwarded-for");
    const ip = forwarded ? forwarded.split(",")[0] : "unknown";
    const userAgent = headersList.get("user-agent") || "unknown";
    const hourBucket = Math.floor(Date.now() / (1000 * 60 * 60)); // Changes every hour
    const sessionId = Buffer.from(`${ip}:${userAgent}:${hourBucket}`).toString("base64").slice(0, 64);

    // Try to insert view (will fail if duplicate due to unique constraint)
    const { error } = await supabase
      .from("trip_views")
      .insert({
        trip_id: id,
        viewer_id: user?.id || null,
        source: source || "direct",
        session_id: sessionId,
      });

    // Ignore unique constraint errors (duplicate view)
    if (error && error.code !== "23505") { // 23505 = unique_violation
      console.error("[Trip View] Insert error:", error);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Trip View] Unexpected error:", error);
    // Don't fail the request for view tracking errors
    return NextResponse.json({ success: true });
  }
}
