import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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

    // Get referrer's display name.
    //
    // Reads public_profiles, not public.users. This endpoint is hit by
    // ANONYMOUS visitors following a referral link, and since 20260820210000
    // anon has no grant on public.users at all — this query started returning
    // 42501. The error is not checked (deliberately: click tracking is
    // best-effort), so the only symptom was referrer_name below silently
    // degrading to "A friend" on every referral landing.
    const { data: referrer } = await supabase
      .from("public_profiles")
      .select("display_name, avatar_url")
      .eq("id", referralCode.user_id)
      .single();

    // Hash IP for privacy-conscious fraud detection
    const forwarded = request.headers.get("x-forwarded-for");
    const ip = forwarded ? forwarded.split(",")[0] : "unknown";
    const hashSalt = process.env.IP_HASH_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY || "fallback-salt";
    const ipHash = createHash("sha256").update(ip + hashSalt).digest("hex").slice(0, 16);

    // Record the click event with the SERVICE client.
    //
    // This endpoint is called by ANONYMOUS visitors, and referral_events has
    // no INSERT policy and no grant to anon — so this insert has always
    // returned 42501 and the whole table holds 5 rows. Because the error is
    // logged and swallowed (click tracking is best-effort) nothing ever
    // surfaced; it just showed up as a steady drip of
    // "[Referral Click] Error recording event: permission denied" in the
    // runtime logs from real traffic.
    //
    // Writing server-side rather than granting anon INSERT keeps the table
    // closed to the public: an anon grant would let anyone forge click events
    // for any code. This mirrors the counter bump below, which already uses a
    // SECURITY DEFINER RPC for exactly the same reason. The referral code was
    // validated above, so the row is well-formed by construction.
    const { error: eventError } = await createAdminClient()
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

    // Atomic increment via RPC (added in migration
    // 20260524_atomic_counters.sql). Replaces the previous
    // read-modify-write pattern that:
    //  (a) was racy under concurrent clicks, dropping increments
    //  (b) had a `x || 0 + 1` precedence bug that froze the count
    //      at 1 indefinitely
    // The RPC's UPDATE is single-statement-atomic and runs as
    // SECURITY DEFINER so it bypasses RLS for the counter bump
    // without needing the service-role key here.
    const { error: rpcError } = await supabase.rpc(
      "increment_referral_clicks",
      { code_id: referralCode.id }
    );
    if (rpcError) {
      // Log but don't fail the user-facing response — click tracking
      // is best-effort; the referrer page should still render.
      console.warn("[referral/click] RPC failed:", rpcError.message);
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
