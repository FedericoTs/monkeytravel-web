import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/**
 * GET /api/referral/code
 * Returns the current user's referral code (creates one if doesn't exist)
 */
export async function GET() {
  try {
    const supabase = await createClient();

    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Check if user already has a referral code
    const { data: existingCode } = await supabase
      .from("referral_codes")
      .select("code, total_clicks, total_signups, total_conversions")
      .eq("user_id", user.id)
      .single();

    if (existingCode) {
      return NextResponse.json({
        code: existingCode.code,
        stats: {
          clicks: existingCode.total_clicks,
          signups: existingCode.total_signups,
          conversions: existingCode.total_conversions,
        },
      });
    }

    // Generate new referral code using the database function
    const { data: newCode, error: createError } = await supabase
      .rpc("get_or_create_referral_code", { p_user_id: user.id });

    if (createError) {
      console.error("[Referral Code] Error creating code:", createError);
      return NextResponse.json(
        { error: "Failed to create referral code" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      code: newCode,
      stats: {
        clicks: 0,
        signups: 0,
        conversions: 0,
      },
    });
  } catch (error) {
    console.error("[Referral Code] Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
