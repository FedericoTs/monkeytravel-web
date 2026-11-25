/**
 * POST /api/wizard/route-plan: the bases of a trip whose destination was typed
 * as a whole country or region ("Thailand", 14 days), for step 1 to offer as a
 * trip through several cities. No account, nothing stored. A city, a place seen
 * from one base, or a question that fails answers `route: []`, and step 1
 * offers nothing: the trip stays one place, as typed.
 */
import { NextRequest } from "next/server";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import { apiSuccess, errors } from "@/lib/api/response-wrapper";
import { createRateLimiter } from "@/lib/api/rate-limit";
import { checkApiAccess, logApiCall } from "@/lib/api-gateway";
import { readJsonBody } from "@/lib/api/json-body";
import { askForRoute, routeFor } from "@/lib/ai/route-plan";
import { routeRows } from "@/lib/ai/assistant/route";
import { resolveAiLanguage } from "@/lib/ai/language";
import { isValidIsoDate } from "@/lib/dates/iso-date";
import { DESTINATION_MAX_LENGTH, DESTINATION_MIN_LENGTH, MAX_TRIP_DAYS_MULTI } from "@/lib/trips/request-limits";

export const maxDuration = 30;

// A visitor tries a place or two before planning, and step 1 asks again each
// time typing pauses (hooks/useRouteOffer.ts), so a place typed slowly on a
// phone asks many times in a minute. Every ask counts, refused ones too.
// These leave room for that and still stop a script; an ask costs a fraction
// of a cent.
const routeIpLimiter = createRateLimiter("route-plan", 40, 24 * 60 * 60 * 1000);
const routeBurstLimiter = createRateLimiter("route-plan-burst", 12, 60 * 1000);

const BodySchema = z.object({
  place: z.string().trim().min(DESTINATION_MIN_LENGTH).max(DESTINATION_MAX_LENGTH),
  days: z.number().int().min(2).max(MAX_TRIP_DAYS_MULTI),
  // The trip's first day: the season decides the route (monsoon coasts, winter passes).
  startDate: z.string().refine(isValidIsoDate).optional(),
  locale: z.string().trim().max(10).optional(),
});

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const { body: raw, invalidBody } = await readJsonBody<unknown>(request);
  if (invalidBody) return invalidBody;
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) return errors.badRequest("Invalid request", { issues: parsed.error.issues });
  const body = parsed.data;

  const access = await checkApiAccess("gemini");
  if (!access.allowed) return errors.serviceUnavailable(access.message || "Try again shortly.");

  const sessionId = request.cookies.get("mt_session_id")?.value || undefined;
  const open = { allowed: true, remaining: 0 };
  const [dayOk, burstOk] = await Promise.all([
    routeIpLimiter.check(request).catch(() => open),
    routeBurstLimiter.check(request, sessionId).catch(() => open),
  ]);
  if (!dayOk.allowed || !burstOk.allowed) {
    waitUntil(
      logApiCall({
        apiName: "gemini",
        endpoint: "/api/wizard/route-plan",
        status: 429,
        responseTimeMs: Date.now() - startedAt,
        cacheHit: false,
        costUsd: 0,
        exactCost: true,
        error: dayOk.allowed ? "burst" : "daily cap (per IP)",
      }).catch(() => undefined)
    );
    return errors.rateLimit("Too many routes asked.");
  }

  const month = body.startDate ? Number(body.startDate.slice(5, 7)) : null;
  const { answer, costUsd } = await askForRoute(body.place, body.days, month, resolveAiLanguage(body.locale));
  const stops = answer ? routeFor(answer, body.place, body.days) : [];
  waitUntil(
    logApiCall({
      apiName: "gemini",
      endpoint: "/api/wizard/route-plan",
      status: answer ? 200 : 502,
      responseTimeMs: Date.now() - startedAt,
      cacheHit: false,
      costUsd,
      exactCost: true,
      error: answer ? null : "no answer",
      metadata: { days: body.days, stops: stops.length },
    }).catch(() => undefined)
  );
  return apiSuccess({ route: routeRows(stops) });
}
