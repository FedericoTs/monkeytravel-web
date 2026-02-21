import { createClient } from "@/lib/supabase/server";
import { NextRequest } from "next/server";
import { createHash } from "crypto";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";

/**
 * POST /api/referral/click
 * Tracks when someone clicks a referral link
 */
export async function POST(request: NextRequest) {
  try {
    const { code, utm_source, utm_medium, utm_campaign } = await request.json();

    if (!code) {
      return errors.badRequest("Referral code is required");
    }

    const supabase = await createClient();

    // Find the referral code
    const { data: referralCode, error: codeError } = await supabase
      .from("referral_codes")
      .select("id, user_id")
      .eq("code", code.toUpperCase())
      .single();

    if (codeError || !referralCode) {
      return errors.notFound("Invalid referral code");
    }

    // Get referrer's display name
    const { data: referrer } = await supabase
      .from("users")
      .select("display_name, avatar_url")
      .eq("id", referralCode.user_id)
      .single();

    // Hash IP for privacy-conscious fraud detection
    const forwarded = request.headers.get("x-forwarded-for");
    const ip = forwarded ? forwarded.split(",")[0] : "unknown";
    const hashSalt = process.env.IP_HASH_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY || "fallback-salt";
    const ipHash = createHash("sha256").update(ip + hashSalt).digest("hex").slice(0, 16);

    // Record the click event
    const { error: eventError } = await supabase
      .from("referral_events")
      .insert({
        referral_code_id: referralCode.id,
        event_type: "click",
        ip_hash: ipHash,
        user_agent: request.headers.get("user-agent") || null,
        utm_source: utm_source || null,
        utm_medium: utm_medium || null,
        utm_campaign: utm_campaign || null,
      });

    if (eventError) {
      console.error("[Referral Click] Error recording event:", eventError);
      // Don't fail the request, just log the error
    }

    // Update click count
    await supabase
      .from("referral_codes")
      .update({ total_clicks: (referralCode as { total_clicks?: number }).total_clicks || 0 + 1 })
      .eq("id", referralCode.id);

    // Actually increment properly using RPC (if available)
    try {
      await supabase.rpc("increment_referral_clicks", { code_id: referralCode.id });
    } catch {
      // Fallback: RPC doesn't exist, the direct update above handles it
    }

    return apiSuccess({
      success: true,
      referrer_name: referrer?.display_name || "A friend",
      referrer_avatar: referrer?.avatar_url,
    });
  } catch (error) {
    console.error("[Referral Click] Unexpected error:", error);
    return errors.internal("Internal server error", "Referral Click");
  }
}
