/**
 * POST /api/affiliates/hostelworld/click
 *
 * Fire-and-forget click logger for the Backpacker Mode → Hostelworld
 * CTA (components/trip/BackpackerHostelCta.tsx). Each click writes one
 * row into public.hostelworld_clicks so we can report:
 *
 *   "We drove N hostel searches to you in the last 30 days."
 *
 * — the headline metric for the partnership conversation. PostHog
 * also captures the same event for product analytics; this table is
 * the defensible, queryable number for outreach.
 *
 * Design:
 *   - Service-role insert (RLS on the table is closed; no client-direct).
 *   - Rate-limited per IP — 60/hour. Same key family as /api/contact.
 *     Stops trivial click-spam from inflating the count.
 *   - Auth-optional. We capture user_id when present + visitor_cookie
 *     (mt_saver_cookie) when not. Either or neither — both fine.
 *   - Returns 204 (No Content) on every accepted call. The CTA fires
 *     this as fire-and-forget; the response body would only be
 *     wasted bandwidth.
 *
 * Trade-off: we're trusting the client to tell us trip_id + destination
 * + dates + source_path. Those don't gate any privileged action — they
 * just decorate the analytics row — so a malicious client lying about
 * them only pollutes their own count, not the integrity of the metric.
 */

import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { errors } from "@/lib/api/response-wrapper";
import { createRateLimiter } from "@/lib/api/rate-limit";
import { isHostelworldAffiliateActive } from "@/lib/affiliates/hostelworld";

const limiter = createRateLimiter("hostelworld_click", 60, 60 * 60 * 1000);
const COOKIE_NAME = "mt_saver_cookie";

// Tight payload contract — anything else is silently dropped, even if
// the client sends it.
interface ClickPayload {
  tripId?: string;
  destination?: string;
  startDate?: string;
  endDate?: string;
  sourcePath?: string;
}

function deriveDeviceClass(ua: string | null): string | null {
  if (!ua) return null;
  const lc = ua.toLowerCase();
  if (/(bot|crawl|spider|slurp)/i.test(lc)) return "bot";
  if (/ipad|tablet/i.test(lc)) return "tablet";
  if (/mobile|android|iphone/i.test(lc)) return "mobile";
  return "desktop";
}

function isValidUuid(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
}

function isValidIsoDate(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

export async function POST(request: NextRequest) {
  try {
    const { allowed } = limiter.check(request);
    if (!allowed) {
      // Silent 204 even when rate-limited — the metric isn't worth
      // bothering the user about. The limiter still drops the write.
      return new Response(null, { status: 204 });
    }

    const body = (await request.json().catch(() => null)) as ClickPayload | null;
    if (!body || typeof body !== "object") {
      // Malformed body → still return 204 so the client can't tell.
      return new Response(null, { status: 204 });
    }

    // Identify the visitor — auth user or saver cookie. Either or neither.
    const supabaseUser = await createServerClient();
    const { data: { user } } = await supabaseUser.auth.getUser();
    const cookieStore = await cookies();
    const visitorCookie = cookieStore.get(COOKIE_NAME)?.value ?? null;

    // Service-role client for the insert (RLS is closed).
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      console.error("[hostelworld_click] missing service-role env, dropping click");
      return new Response(null, { status: 204 });
    }
    const svc = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const row = {
      trip_id: isValidUuid(body.tripId) ? body.tripId : null,
      user_id: user?.id ?? null,
      visitor_cookie: !user ? visitorCookie : null,
      destination:
        typeof body.destination === "string"
          ? body.destination.slice(0, 200)
          : null,
      start_date: isValidIsoDate(body.startDate) ? body.startDate : null,
      end_date: isValidIsoDate(body.endDate) ? body.endDate : null,
      source_path:
        typeof body.sourcePath === "string"
          ? body.sourcePath.slice(0, 500)
          : null,
      device_class: deriveDeviceClass(request.headers.get("user-agent")),
      is_tracked: isHostelworldAffiliateActive(),
    };

    const { error } = await svc.from("hostelworld_clicks").insert(row);
    if (error) {
      console.error("[hostelworld_click] insert failed:", error.message);
    }

    return new Response(null, { status: 204 });
  } catch (err) {
    console.error("[hostelworld_click] unexpected error:", err);
    // Always 204 to the client — failed analytics shouldn't surface.
    return new Response(null, { status: 204 });
  }
}

// HEAD support — some clients (Sentry browser SDK, certain CDN probes)
// fire a HEAD before POST. Bypass everything and return 204.
export async function HEAD() {
  return new Response(null, { status: 204 });
}

// Keep the bundle lean.
export const dynamic = "force-dynamic";

// Silence the eslint hint about a fully-typed errors import we don't
// use in the success path — the catch may still need it indirectly.
void errors;
