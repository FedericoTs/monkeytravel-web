import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { isExploreUgcEnabled } from "@/lib/explore/flag";
import { captureServerEvent } from "@/lib/posthog/server";

/**
 * POST /api/trips/[id]/report — flag a public trip for moderation.
 *
 * Body: { reason: string (1-500 chars) }
 *
 * Works for both anon (IP-keyed rate limit) and auth (also stamps
 * reporter_user_id). Triggers auto-hide if reported_count >= 5
 * AFTER this report lands.
 *
 * Rate limit: 3 reports per IP per 24h. Counted via trip_reports
 * scan with the indexed reporter_ip query.
 */

type RouteCtx = { params: Promise<{ id: string }> };

const REPORT_RATE_LIMIT_PER_IP = 3;
const REPORT_RATE_WINDOW_HOURS = 24;
const AUTO_HIDE_THRESHOLD = 5;
const MAX_REASON_LENGTH = 500;

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env missing for service client");
  return createServiceClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function getClientIp(request: NextRequest): string | null {
  // Vercel sets x-forwarded-for; first IP in the list is the client.
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return request.headers.get("x-real-ip");
}

export async function POST(request: NextRequest, { params }: RouteCtx) {
  if (!isExploreUgcEnabled()) return errors.notFound("Not Found");

  const { id: tripId } = await params;
  if (!tripId) return errors.badRequest("Trip id required");

  const body = await request.json().catch(() => ({}));
  const reason =
    typeof body?.reason === "string"
      ? body.reason.trim().slice(0, MAX_REASON_LENGTH)
      : "";
  if (!reason) {
    return errors.badRequest("Reason is required");
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Validate the trip is publicly reportable. (Can't report private
  // trips; can't report already-hidden trips.)
  const { data: trip } = await supabase
    .from("trips")
    .select("id, visibility, is_hidden")
    .eq("id", tripId)
    .single();
  if (!trip) return errors.notFound("Trip not found");
  if (trip.visibility !== "public" || trip.is_hidden) {
    return errors.notFound("Trip not found");
  }

  const ip = getClientIp(request);

  // Rate-limit: 3 reports per IP per 24h. (Auth users still subject
  // to the IP rate limit so a single user can't open a tab in 6
  // private windows.)
  if (ip) {
    const since = new Date(
      Date.now() - REPORT_RATE_WINDOW_HOURS * 3_600_000
    ).toISOString();
    const { count: recentCount } = await serviceClient()
      .from("trip_reports")
      .select("id", { count: "exact", head: true })
      .eq("reporter_ip", ip)
      .gte("created_at", since);
    if ((recentCount ?? 0) >= REPORT_RATE_LIMIT_PER_IP) {
      return errors.badRequest(
        "Report rate limit reached. Try again later."
      );
    }
  }

  // Insert report (service role — trip_reports has no public policies).
  const svc = serviceClient();
  const { error: insertErr } = await svc.from("trip_reports").insert({
    trip_id: tripId,
    reporter_ip: ip,
    reporter_user_id: user?.id ?? null,
    reason,
  });
  if (insertErr) {
    return errors.internal("Failed to record report", "trip_reports.insert");
  }

  // Bump the trip's reported_count atomically and auto-hide if the
  // post-update count crosses the threshold. The RPC returns the new
  // count in a single statement so two concurrent reports can't both
  // read N and write N+1 (lost-increment race that the previous
  // read-modify-write had). Mirrors the like / save / fork pattern in
  // 20260525_explore_ugc_feed.sql.
  const { data: newCount, error: bumpErr } = await svc.rpc(
    "increment_trip_reported_count",
    { p_trip_id: tripId }
  );
  if (bumpErr) {
    // Counter didn't move — log for the daily reconcile job. Skip the
    // auto-hide check since the threshold can't have crossed.
    console.error("[trip-report] counter drift after insert:", bumpErr);
  }
  const newReportCount = typeof newCount === "number" ? newCount : 0;
  if (newReportCount >= AUTO_HIDE_THRESHOLD) {
    await svc
      .from("trips")
      .update({ is_hidden: true })
      .eq("id", tripId);
  }

  void captureServerEvent(user?.id ?? "anon", "explore_trip_reported", {
    trip_id: tripId,
    auto_hidden: newReportCount >= AUTO_HIDE_THRESHOLD,
    report_count: newReportCount,
  });

  return apiSuccess({
    reported: true,
    autoHidden: newReportCount >= AUTO_HIDE_THRESHOLD,
  });
}
