/**
 * POST /api/wizard/read-request: a trip typed into step 1's destination box as
 * a request ("18 days in Vietnam in August, family of four"), read into the
 * wizard's fields. No account, nothing stored: the page fills step 1 from the
 * reading and keeps the words for the planner. A reading that fails is `null`
 * and the page keeps the words as notes, so nothing here is a dead end.
 */
import { NextRequest } from "next/server";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import { apiSuccess, errors } from "@/lib/api/response-wrapper";
import { createRateLimiter } from "@/lib/api/rate-limit";
import { checkApiAccess, logApiCall } from "@/lib/api-gateway";
import { readJsonBody } from "@/lib/api/json-body";
import { askForReading } from "@/lib/ai/read-request";
import { resolveAiLanguage } from "@/lib/ai/language";
import { isValidIsoDate } from "@/lib/dates/iso-date";
import { REQUIREMENTS_MAX } from "@/lib/trips/request-limits";
import { readingOf } from "@/lib/wizard/request-reading";

export const maxDuration = 30;

// A visitor reads a request or two before planning; these leave room for
// several tries and stop a script.
const readIpLimiter = createRateLimiter("read-request", 20, 24 * 60 * 60 * 1000);
const readBurstLimiter = createRateLimiter("read-request-burst", 4, 60 * 1000);

const BodySchema = z.object({
  text: z.string().trim().min(3).max(REQUIREMENTS_MAX),
  // The traveller's own date: "in August" and "the 22nd" count from it.
  today: z.string().refine(isValidIsoDate),
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
    readIpLimiter.check(request).catch(() => open),
    readBurstLimiter.check(request, sessionId).catch(() => open),
  ]);
  if (!dayOk.allowed || !burstOk.allowed) {
    waitUntil(
      logApiCall({
        apiName: "gemini",
        endpoint: "/api/wizard/read-request",
        status: 429,
        responseTimeMs: Date.now() - startedAt,
        cacheHit: false,
        costUsd: 0,
        exactCost: true,
        error: dayOk.allowed ? "burst" : "daily cap (per IP)",
      }).catch(() => undefined)
    );
    return errors.rateLimit("Too many requests read.");
  }

  const { answer, costUsd } = await askForReading(body.text, body.today, resolveAiLanguage(body.locale));
  const reading = answer ? readingOf(answer, body.today) : null;
  waitUntil(
    logApiCall({
      apiName: "gemini",
      endpoint: "/api/wizard/read-request",
      status: answer ? 200 : 502,
      responseTimeMs: Date.now() - startedAt,
      cacheHit: false,
      costUsd,
      exactCost: true,
      error: answer ? null : "not read",
      metadata: reading ? { places: reading.places.length, dates: reading.startDate !== null } : undefined,
    }).catch(() => undefined)
  );
  return apiSuccess({ reading });
}
