import { NextRequest } from "next/server";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { logApiCall } from "@/lib/api-gateway";
import { generatePackingList } from "@/lib/ai/packing-list";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/tools/packing-list
 *
 * Free lead-gen tool. Generates a personalized packing list from
 * destination + dates + style + optional activities. Anonymous-friendly
 * (no auth required) but rate-limited by IP to prevent abuse.
 *
 * Request body:
 *   {
 *     "destination": "Tokyo, Japan",
 *     "startDate": "2026-06-10",
 *     "endDate": "2026-06-17",
 *     "travelStyle": "city" | "beach" | "adventure" | "business" | "wellness" | "mixed",
 *     "activities": ["hiking", "fine_dining"],   // optional
 *     "locale": "en" | "it" | "es"                // optional, defaults en
 *   }
 *
 * Response 200:
 *   { "list": { categories: [...], contextNote: "..." } }
 *
 * Response 400: validation error
 * Response 429: rate-limit hit (basic per-IP cap)
 * Response 503: AI failure
 */

// Per-process in-memory rate limit. Good enough for an anonymous tool
// where we just want to slow down obvious abuse, not enforce a strict
// per-user quota. Vercel functions can warm-start so this isn't
// perfect — if abuse becomes a problem, swap for a Redis bucket.
const ipBuckets = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_PER_IP = 10; // 10 lists per hour per IP

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

function checkRateLimit(ip: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const bucket = ipBuckets.get(ip);
  if (!bucket || bucket.resetAt < now) {
    ipBuckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, remaining: RATE_LIMIT_PER_IP - 1 };
  }
  if (bucket.count >= RATE_LIMIT_PER_IP) {
    return { allowed: false, remaining: 0 };
  }
  bucket.count += 1;
  return { allowed: true, remaining: RATE_LIMIT_PER_IP - bucket.count };
}

const VALID_STYLES = ["city", "beach", "adventure", "business", "wellness", "mixed"];
const VALID_LOCALES = ["en", "it", "es"];

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const ip = clientIp(request);

  // Auth is optional — we just read it for usage tracking.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isAnonymous = user === null;

  // Anonymous rate-limit; authed users skip (they're already on the
  // hook for their account quota elsewhere).
  if (isAnonymous) {
    const limit = checkRateLimit(ip);
    if (!limit.allowed) {
      return errors.rateLimit(
        "Free hourly limit reached. Sign up to keep using the Packing List Generator.",
        { signupUrl: "/auth/signup" }
      );
    }
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return errors.badRequest("Body must be valid JSON");
  }

  const destination = typeof body.destination === "string" ? body.destination.trim() : "";
  const startDate = typeof body.startDate === "string" ? body.startDate : "";
  const endDate = typeof body.endDate === "string" ? body.endDate : "";
  const travelStyle =
    typeof body.travelStyle === "string" ? body.travelStyle : "city";
  const activities = Array.isArray(body.activities)
    ? body.activities.filter((a): a is string => typeof a === "string").slice(0, 12)
    : [];
  const locale = typeof body.locale === "string" ? body.locale : "en";

  if (!destination || destination.length < 2 || destination.length > 100) {
    return errors.badRequest("destination is required (2-100 chars)");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return errors.badRequest("startDate and endDate must be YYYY-MM-DD");
  }
  if (new Date(endDate).getTime() < new Date(startDate).getTime()) {
    return errors.badRequest("endDate must be on or after startDate");
  }
  const days =
    Math.ceil(
      (new Date(endDate).getTime() - new Date(startDate).getTime()) /
        (1000 * 60 * 60 * 24)
    ) + 1;
  if (days > 30) {
    return errors.badRequest("Trip length capped at 30 days for the packing tool");
  }
  if (!VALID_STYLES.includes(travelStyle)) {
    return errors.badRequest(
      `travelStyle must be one of: ${VALID_STYLES.join(", ")}`
    );
  }
  if (!VALID_LOCALES.includes(locale)) {
    return errors.badRequest(
      `locale must be one of: ${VALID_LOCALES.join(", ")}`
    );
  }

  try {
    const list = await generatePackingList({
      destination,
      startDate,
      endDate,
      travelStyle: travelStyle as "city" | "beach" | "adventure" | "business" | "wellness" | "mixed",
      activities,
      locale: locale as "en" | "it" | "es",
    });

    await logApiCall({
      apiName: "gemini",
      endpoint: "/api/tools/packing-list",
      status: 200,
      responseTimeMs: Date.now() - startTime,
      cacheHit: false,
      costUsd: 0.0002,
      metadata: {
        user_id: user?.id ?? "anonymous",
        is_anonymous: isAnonymous,
        destination,
        days,
        style: travelStyle,
        locale,
        activities_count: activities.length,
      },
    });

    return apiSuccess({ list });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generation failed";
    console.error("[/api/tools/packing-list]", message);
    await logApiCall({
      apiName: "gemini",
      endpoint: "/api/tools/packing-list",
      status: 503,
      responseTimeMs: Date.now() - startTime,
      cacheHit: false,
      costUsd: 0,
      error: message,
      metadata: { user_id: user?.id ?? "anonymous", is_anonymous: isAnonymous },
    });
    return errors.serviceUnavailable(
      "Could not generate the packing list right now. Try again in a moment."
    );
  }
}
