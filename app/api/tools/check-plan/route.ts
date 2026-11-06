import { NextRequest } from "next/server";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { blockedCall, checkApiAccess, logApiCall } from "@/lib/api-gateway";
import { withinAnonDailyLimit } from "@/lib/ai/anon-daily-limit";
import { GeminiCostMeter } from "@/lib/ai/gemini-cost";
import { createClient } from "@/lib/supabase/server";
import { readJsonBody } from "@/lib/api/json-body";
import { createRateLimiter } from "@/lib/api/rate-limit";
import { checkPlan } from "@/lib/plans/plan-check";
import { MAX_PLAN_TEXT_CHARS, extractPastedPlan, isPastedPlanError } from "@/lib/plans/plan-check-extract";

/**
 * POST /api/tools/check-plan
 *
 * Check my plan: a plan pasted from anywhere comes back with its closed places
 * to eat and its overfull days. One cheap model call, then Text Search for up
 * to MAX_PLACE_LOOKUPS places. Nothing is stored.
 *
 * Request: { "text": "Day 1: ..." }
 * Response 200: PlanReport (lib/plans/plan-check.ts)
 * Response 400: too little text, or nothing plan-like in it (carries `reason`)
 * Response 429: too many checks from this network or account today
 * Response 503: Gemini failed, or its kill switch or daily limit said no
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const anonLimiter = createRateLimiter("check-plan", 5, DAY_MS);
const accountLimiter = createRateLimiter("check-plan-account", 20, DAY_MS);
// All checks together, since each search counts against Google's free tier.
// Past it a check still reads the days, and says the places weren't looked up.
const lookupBudget = createRateLimiter("check-plan-lookups", 12, DAY_MS);

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const geminiCost = new GeminiCostMeter();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isAnonymous = user === null;

  const { allowed } = await (user ? accountLimiter.check(request, user.id) : anonLimiter.check(request));
  if (!allowed) return errors.rateLimit("You've checked a lot of plans today. Try again tomorrow.");

  const { body, invalidBody } = await readJsonBody<{ text?: unknown }>(request);
  if (invalidBody) return invalidBody;
  const text = typeof body.text === "string" ? body.text : "";
  if (!text.trim()) return errors.badRequest("Paste a plan to check", { reason: "too_short" });
  if (text.length > MAX_PLAN_TEXT_CHARS * 2) return errors.badRequest("That's too long to check", { reason: "too_long" });

  const log = (status: number, metadata: Record<string, unknown> = {}, error?: string) =>
    logApiCall({
      apiName: "gemini",
      endpoint: "/api/tools/check-plan",
      status,
      responseTimeMs: Date.now() - startTime,
      cacheHit: false,
      costUsd: geminiCost.usd,
      exactCost: true,
      ...(error ? { error } : {}),
      metadata: { user_id: user?.id ?? "anonymous", is_anonymous: isAnonymous, text_length: text.length, ...metadata },
    });

  const access = await checkApiAccess("gemini");
  if (!access.allowed) {
    return blockedCall(access, {
      apiName: "gemini",
      endpoint: "/api/tools/check-plan",
      startTime,
      metadata: { user_id: user?.id ?? "anonymous", is_anonymous: isAnonymous },
      disabled: "Checking a plan is currently disabled",
    });
  }
  if (isAnonymous && !(await withinAnonDailyLimit())) {
    return errors.rateLimit("We've reached today's limit for free checks. Try again tomorrow.");
  }

  const plan = await geminiCost.run(() => extractPastedPlan(text));
  if (isPastedPlanError(plan)) {
    await log(plan.error === "extract_failed" || plan.error === "model_outage" ? 503 : 400, {}, plan.error);
    if (plan.error === "model_outage") return errors.modelOutage();
    if (plan.error === "too_short") return errors.badRequest("Paste a bit more: we couldn't find a plan in that.", { reason: "too_short" });
    if (plan.error === "nothing_found") return errors.badRequest("We couldn't find a trip plan in that text.", { reason: "nothing_found" });
    return errors.serviceUnavailable("Couldn't read that plan right now. Try again in a moment.");
  }

  const { allowed: lookUp } = await lookupBudget.checkKey("all");
  const report = await checkPlan(plan, { lookUp });
  await log(200, {
    days: report.days.length,
    looked: report.looked,
    closed: report.closed,
    missing: report.missing,
    packed_days: report.packedDays,
    looked_up: lookUp,
  });
  return apiSuccess({ ...report, lookedUp: lookUp }, { headers: { "Cache-Control": "no-store" } });
}
