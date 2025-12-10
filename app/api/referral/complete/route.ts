import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/**
 * POST /api/referral/complete
 * Called when a referred user creates their first trip
 * Grants rewards to both referrer and referee
 */
export async function POST() {
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

    // Get user's referral info
    const { data: currentUser } = await supabase
      .from("users")
      .select("referred_by_code, referral_completed_at, free_trips_remaining")
      .eq("id", user.id)
      .single();

    // Check if user was referred and hasn't completed yet
    if (!currentUser?.referred_by_code) {
      return NextResponse.json({
        success: false,
        message: "User was not referred",
      });
    }

    if (currentUser.referral_completed_at) {
      return NextResponse.json({
        success: false,
        message: "Referral reward already claimed",
      });
    }

    // Find the referrer's code
    const { data: referralCode } = await supabase
      .from("referral_codes")
      .select("id, user_id, total_conversions")
      .eq("code", currentUser.referred_by_code)
      .single();

    if (!referralCode) {
      return NextResponse.json({
        success: false,
        message: "Referral code not found",
      });
    }

    // Get referrer's current free trips
    const { data: referrer } = await supabase
      .from("users")
      .select("free_trips_remaining")
      .eq("id", referralCode.user_id)
      .single();

    // Start transaction-like operations
    const now = new Date().toISOString();

    // 1. Grant reward to referee (current user)
    const { error: refereeError } = await supabase
      .from("users")
      .update({
        free_trips_remaining: (currentUser.free_trips_remaining || 0) + 1,
        referral_completed_at: now,
      })
      .eq("id", user.id);

    if (refereeError) {
      console.error("[Referral Complete] Error updating referee:", refereeError);
      return NextResponse.json(
        { error: "Failed to grant reward to referee" },
        { status: 500 }
      );
    }

    // 2. Grant reward to referrer
    const { error: referrerError } = await supabase
      .from("users")
      .update({
        free_trips_remaining: (referrer?.free_trips_remaining || 0) + 1,
      })
      .eq("id", referralCode.user_id);

    if (referrerError) {
      console.error("[Referral Complete] Error updating referrer:", referrerError);
      // Don't fail - referee already got their reward
    }

    // 3. Record conversion event
    const { error: eventError } = await supabase
      .from("referral_events")
      .insert({
        referral_code_id: referralCode.id,
        referee_id: user.id,
        event_type: "conversion",
        reward_granted_at: now,
        reward_amount: 1,
      });

    if (eventError) {
      console.error("[Referral Complete] Error recording event:", eventError);
    }

    // 4. Update conversion count
    await supabase
      .from("referral_codes")
      .update({
        total_conversions: (referralCode.total_conversions || 0) + 1,
      })
      .eq("id", referralCode.id);

    return NextResponse.json({
      success: true,
      referrer_rewarded: !referrerError,
      referee_rewarded: true,
      message: "Congratulations! You and your friend each earned 1 free trip!",
    });
  } catch (error) {
    console.error("[Referral Complete] Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
