import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

/**
 * Daily cron — recomputes `trips.is_editors_pick`.
 *
 * Algorithm (locked decision, see docs/PLAN_EXPLORE_UGC_FEED.md §9):
 *   is_editors_pick = TRUE iff
 *     age_days >= 7
 *     AND fork_count >= 5
 *     AND trending_score >= 50
 *     AND visibility = 'public'
 *     AND is_hidden = false
 *
 * Otherwise false. The flag is recomputed from scratch every day, so
 * trips can both enter and exit the set as engagement changes.
 *
 * Schedule: daily via Vercel cron (vercel.json — to be added). For
 * manual triggers, hit /api/cron/recompute-editors-picks with
 * `Authorization: Bearer ${CRON_SECRET}`.
 *
 * Auth: CRON_SECRET. Without it, returns 401. Vercel's cron sends
 * the secret automatically when configured.
 */

const ELIGIBILITY = {
  MIN_AGE_DAYS: 7,
  MIN_FORK_COUNT: 5,
  MIN_TRENDING_SCORE: 50,
};

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env missing for cron");
  return createServiceClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Don't run unauthenticated, even if CRON_SECRET isn't set.
    return unauthorized();
  }
  if (auth !== `Bearer ${secret}`) return unauthorized();

  const svc = serviceClient();
  const cutoffDate = new Date(
    Date.now() - ELIGIBILITY.MIN_AGE_DAYS * 86_400_000
  ).toISOString();

  // 1. Find every trip that SHOULD be an editor's pick.
  const { data: eligible, error: eligibleErr } = await svc
    .from("trips")
    .select("id")
    .eq("visibility", "public")
    .eq("is_hidden", false)
    .gte("fork_count", ELIGIBILITY.MIN_FORK_COUNT)
    .gte("trending_score", ELIGIBILITY.MIN_TRENDING_SCORE)
    .lte("created_at", cutoffDate);

  if (eligibleErr) {
    console.error("[editors-picks-cron] eligibility query failed:", eligibleErr);
    return NextResponse.json(
      { error: "Eligibility query failed" },
      { status: 500 }
    );
  }

  const eligibleIds = new Set((eligible ?? []).map((t) => t.id));

  // 2. Clear flag on everything that was previously a pick but no
  //    longer qualifies.
  const { data: previouslyPicked } = await svc
    .from("trips")
    .select("id")
    .eq("is_editors_pick", true);

  const toUnflag = (previouslyPicked ?? [])
    .map((t) => t.id)
    .filter((id) => !eligibleIds.has(id));

  if (toUnflag.length > 0) {
    await svc
      .from("trips")
      .update({ is_editors_pick: false })
      .in("id", toUnflag);
  }

  // 3. Set flag on newly-eligible trips. (Idempotent — re-setting true
  //    on existing picks is a no-op.)
  if (eligibleIds.size > 0) {
    await svc
      .from("trips")
      .update({ is_editors_pick: true })
      .in("id", Array.from(eligibleIds));
  }

  return NextResponse.json({
    success: true,
    eligibleCount: eligibleIds.size,
    unflaggedCount: toUnflag.length,
    timestamp: new Date().toISOString(),
  });
}
