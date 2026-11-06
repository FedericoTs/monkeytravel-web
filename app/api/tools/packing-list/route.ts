import { NextRequest } from "next/server";
import { getTranslations } from "next-intl/server";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { blockedCall, checkApiAccess, logApiCall } from "@/lib/api-gateway";
import { withinAnonDailyLimit } from "@/lib/ai/anon-daily-limit";
import { GeminiCostMeter } from "@/lib/ai/gemini-cost";
import { isModelOutOfCredit } from "@/lib/ai/model-outage";
import {
  generatePackingList,
  type PackingCategoryId,
} from "@/lib/ai/packing-list";
import { createClient } from "@/lib/supabase/server";
import { readJsonBody } from "@/lib/api/json-body";
import { createRateLimiter } from "@/lib/api/rate-limit";
import { tripSpanDays } from "@/lib/dates/iso-date";

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
 * Response 429: rate-limit hit (per network signed out, per account signed in)
 * Response 503: AI failure, or Gemini's kill switch or daily limit said no
 */

const HOUR_MS = 60 * 60 * 1000;
const anonLimiter = createRateLimiter("packing-list", 10, HOUR_MS);
const accountLimiter = createRateLimiter("packing-list-account", 40, HOUR_MS);

const VALID_STYLES = ["city", "beach", "adventure", "business", "wellness", "mixed"];
// Every app locale, or its users get 400s.
const VALID_LOCALES = ["en", "it", "es", "pt"];

/**
 * Wrap a next-intl translator call so an unknown category id (e.g. if
 * the model invents a new one) doesn't throw a 500. Falls back to the
 * id itself — the client also has a tolerant icon map keyed on id, so
 * surfacing the raw id is preferable to crashing.
 */
function safeTranslate(
  t: (key: string) => string,
  id: PackingCategoryId
): string {
  try {
    return t(id);
  } catch {
    return id;
  }
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  // Auth is optional: it picks the allowance, and goes in the usage log.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isAnonymous = user === null;

  const { allowed } = await (user ? accountLimiter.check(request, user.id) : anonLimiter.check(request));
  if (!allowed) {
    return errors.rateLimit(
      "Free hourly limit reached. Sign up to keep using the Packing List Generator.",
      { signupUrl: "/auth/signup" }
    );
  }

  const { body, invalidBody } = await readJsonBody<Record<string, unknown>>(request);
  if (invalidBody) return invalidBody;

  const destination = typeof body.destination === "string" ? body.destination.trim() : "";
  const startDate = typeof body.startDate === "string" ? body.startDate : "";
  const endDate = typeof body.endDate === "string" ? body.endDate : "";
  const travelStyle =
    typeof body.travelStyle === "string" ? body.travelStyle : "city";
  const activities = Array.isArray(body.activities)
    ? body.activities.filter((a): a is string => typeof a === "string").slice(0, 12).map((a) => a.slice(0, 60))
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
  const days = tripSpanDays(startDate, endDate);
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

  const access = await checkApiAccess("gemini");
  if (!access.allowed) {
    return blockedCall(access, {
      apiName: "gemini",
      endpoint: "/api/tools/packing-list",
      startTime,
      metadata: { user_id: user?.id ?? "anonymous", is_anonymous: isAnonymous },
      disabled: "The packing list tool is currently disabled",
    });
  }
  if (isAnonymous && !(await withinAnonDailyLimit())) {
    return errors.rateLimit(
      "Free daily limit reached. Sign up to keep using the Packing List Generator.",
      { signupUrl: "/auth/signup" }
    );
  }

  // What the Gemini calls cost, retries included (lib/ai/gemini-cost.ts).
  const geminiCost = new GeminiCostMeter();
  try {
    const list = await geminiCost.run(() => generatePackingList({
      destination,
      startDate,
      endDate,
      travelStyle: travelStyle as "city" | "beach" | "adventure" | "business" | "wellness" | "mixed",
      activities,
      locale: locale as "en" | "it" | "es",
    }));

    // Localize category display labels server-side so the client doesn't
    // need to re-derive them from the English id. Each id maps to a
    // string in messages/<locale>/tools.json under
    // `tools.packingList.categories.<id>`. Pre-fix, the client computed
    // labels from the id alone — which meant any consumer of the raw
    // API (PDF generator, email tool, embed) had to duplicate the
    // mapping. Now `label` is the single source of truth.
    const tCategories = await getTranslations({
      locale,
      namespace: "tools.packingList.categories",
    });
    list.categories = list.categories.map((cat) => ({
      ...cat,
      label: safeTranslate(tCategories, cat.id),
    }));

    await logApiCall({
      apiName: "gemini",
      endpoint: "/api/tools/packing-list",
      status: 200,
      responseTimeMs: Date.now() - startTime,
      cacheHit: false,
      costUsd: geminiCost.usd,
      exactCost: true,
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
      costUsd: geminiCost.usd,
      exactCost: true,
      error: message,
      metadata: { user_id: user?.id ?? "anonymous", is_anonymous: isAnonymous },
    });
    if (isModelOutOfCredit(err)) return errors.modelOutage();
    return errors.serviceUnavailable(
      "Could not generate the packing list right now. Try again in a moment."
    );
  }
}
