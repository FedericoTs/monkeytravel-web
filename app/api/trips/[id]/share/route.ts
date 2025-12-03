import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { v4 as uuidv4 } from "uuid";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/trips/[id]/share - Generate a share link for a trip
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify trip ownership and get current share status
    const { data: trip, error: fetchError } = await supabase
      .from("trips")
      .select("id, user_id, share_token")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (fetchError || !trip) {
      return NextResponse.json({ error: "Trip not found" }, { status: 404 });
    }

    // If already shared, return existing token
    if (trip.share_token) {
      const shareUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://monkeytravel.app"}/shared/${trip.share_token}`;
      return NextResponse.json({
        success: true,
        shareToken: trip.share_token,
        shareUrl,
        isNew: false,
      });
    }

    // Generate new share token
    const shareToken = uuidv4();
    const sharedAt = new Date().toISOString();

    // Update trip with share token
    const { error: updateError } = await supabase
      .from("trips")
      .update({
        share_token: shareToken,
        shared_at: sharedAt,
        visibility: "shared",
      })
      .eq("id", id)
      .eq("user_id", user.id);

    if (updateError) {
      console.error("Error enabling sharing:", updateError);
      return NextResponse.json(
        { error: "Failed to enable sharing" },
        { status: 500 }
      );
    }

    const shareUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://monkeytravel.app"}/shared/${shareToken}`;

    return NextResponse.json({
      success: true,
      shareToken,
      shareUrl,
      sharedAt,
      isNew: true,
    });
  } catch (error) {
    console.error("Error creating share link:", error);
    return NextResponse.json(
      { error: "Failed to create share link" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/trips/[id]/share - Revoke sharing for a trip
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify trip ownership
    const { data: trip, error: fetchError } = await supabase
      .from("trips")
      .select("id, user_id")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (fetchError || !trip) {
      return NextResponse.json({ error: "Trip not found" }, { status: 404 });
    }

    // Remove share token
    const { error: updateError } = await supabase
      .from("trips")
      .update({
        share_token: null,
        shared_at: null,
        visibility: "private",
      })
      .eq("id", id)
      .eq("user_id", user.id);

    if (updateError) {
      console.error("Error revoking share:", updateError);
      return NextResponse.json(
        { error: "Failed to revoke sharing" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error revoking share link:", error);
    return NextResponse.json(
      { error: "Failed to revoke share link" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/trips/[id]/share - Get current share status
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify trip ownership and get share status
    const { data: trip, error: fetchError } = await supabase
      .from("trips")
      .select("id, share_token, shared_at, visibility")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (fetchError || !trip) {
      return NextResponse.json({ error: "Trip not found" }, { status: 404 });
    }

    const isShared = !!trip.share_token;
    const shareUrl = isShared
      ? `${process.env.NEXT_PUBLIC_APP_URL || "https://monkeytravel.app"}/shared/${trip.share_token}`
      : null;

    return NextResponse.json({
      success: true,
      isShared,
      shareToken: trip.share_token,
      shareUrl,
      sharedAt: trip.shared_at,
      visibility: trip.visibility,
    });
  } catch (error) {
    console.error("Error fetching share status:", error);
    return NextResponse.json(
      { error: "Failed to fetch share status" },
      { status: 500 }
    );
  }
}
