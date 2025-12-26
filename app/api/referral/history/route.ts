import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { batchFetchUserProfiles } from "@/lib/api/batch-users";

/**
 * GET /api/referral/history
 * Returns the referral history for the current user
 */
export async function GET() {
  try {
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // Get user's referral code
    const { data: referralCode } = await supabase
      .from("referral_codes")
      .select("id, code, total_clicks, total_signups, total_conversions")
      .eq("user_id", user.id)
      .single();

    if (!referralCode) {
      return apiSuccess({
        referrals: [],
        stats: {
          clicks: 0,
          signups: 0,
          conversions: 0,
        },
        total_earned: 0,
      });
    }

    // Get referral events with referee info
    const { data: events } = await supabase
      .from("referral_events")
      .select(`
        id,
        event_type,
        event_at,
        reward_granted_at,
        reward_amount,
        referee_id
      `)
      .eq("referral_code_id", referralCode.id)
      .in("event_type", ["signup", "conversion"])
      .order("event_at", { ascending: false })
      .limit(50);

    // Get referee display names using batch utility
    const refereeIds = events
      ?.filter(e => e.referee_id)
      .map(e => e.referee_id as string) || [];

    const refereeMap = await batchFetchUserProfiles(supabase, refereeIds);

    // Format referrals
    const referrals = (events || []).map(event => ({
      id: event.id,
      type: event.event_type,
      date: event.event_at,
      rewardedAt: event.reward_granted_at,
      rewardAmount: event.reward_amount,
      referee: event.referee_id ? {
        name: refereeMap.get(event.referee_id)?.display_name || "Anonymous",
        avatar: refereeMap.get(event.referee_id)?.avatar_url,
      } : null,
    }));

    // Calculate total earned (from conversions)
    const totalEarned = (events || [])
      .filter(e => e.event_type === "conversion" && e.reward_granted_at)
      .reduce((sum, e) => sum + (e.reward_amount || 0), 0);

    return apiSuccess({
      code: referralCode.code,
      referrals,
      stats: {
        clicks: referralCode.total_clicks,
        signups: referralCode.total_signups,
        conversions: referralCode.total_conversions,
      },
      total_earned: totalEarned,
    });
  } catch (error) {
    console.error("[Referral History] Unexpected error:", error);
    return errors.internal("Internal server error", "Referral History");
  }
}
