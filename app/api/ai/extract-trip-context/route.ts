import { NextRequest } from "next/server";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { logApiCall } from "@/lib/api-gateway";
import { checkExtractRateLimit, recordExtract } from "@/lib/anonymous/rate-limit-extract";
import { extractTripContext } from "@/lib/gemini-vision";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/ai/extract-trip-context
 *
 * The "Start Anywhere" backend. Accepts an image (URL or base64) and/or
 * web-page text and returns a starter trip config the wizard can pre-fill.
 *
 * Auth: optional. Anonymous callers are rate-limited via the mt_anon_extract
 * cookie (10 per 24h, separate from the generation quota). Authenticated
 * callers are unlimited.
 *
 * Request body:
 *   {
 *     "imageUrl": "https://...",          // either this
 *     "imageBase64": "iVBOR...",          // or this (no data: prefix)
 *     "imageMimeType": "image/png",       // optional, defaults image/jpeg
 *     "websiteText": "Some travel blog post text",  // optional extra context
 *     "userContext": "User is flying from Rome"     // optional caller hint
 *   }
 *
 * Response 200:
 *   {
 *     "context": {
 *       "destination": "Bali, Indonesia",
 *       "destinationConfidence": 0.85,
 *       "vibes": ["nature","romantic"],
 *       "suggestedDurationDays": 7,
 *       "monthHint": "April",
 *       "notes": "Tropical beach with thatched roof — classic Bali honeymoon imagery."
 *     }
 *   }
 *
 * Response 429: anonymous rate limit exceeded ({"error":"...","signupUrl":"/auth/signup"})
 * Response 400: missing / invalid input
 * Response 503: Gemini Vision failed (network, content blocked, etc.)
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Auth is optional — gate only via the anon cookie when no user.
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const isAnonymous = user === null;

    if (isAnonymous) {
      const limit = await checkExtractRateLimit();
      if (!limit.allowed) {
        return errors.rateLimit(
          limit.message || "Free extraction limit reached. Sign up to keep using Start Anywhere.",
          { usage: limit, signupUrl: "/auth/signup" }
        );
      }
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return errors.badRequest("Body must be valid JSON");
    }

    const imageUrl = typeof body.imageUrl === "string" ? body.imageUrl : undefined;
    const imageBase64 = typeof body.imageBase64 === "string" ? body.imageBase64 : undefined;
    const imageMimeType =
      typeof body.imageMimeType === "string" ? body.imageMimeType : undefined;
    const websiteText = typeof body.websiteText === "string" ? body.websiteText : undefined;
    const userContext = typeof body.userContext === "string" ? body.userContext : undefined;

    if (!imageUrl && !imageBase64 && !websiteText) {
      return errors.badRequest(
        "Provide at least one of: imageUrl, imageBase64, websiteText"
      );
    }

    // Hard cap on base64 size so we don't accidentally process a 50MB image
    // server-side. ~7MB encoded is ~5MB original, plenty for any reasonable
    // photo, and stays well under Vercel's 4.5MB serverless body limit if
    // the client also enforces.
    if (imageBase64 && imageBase64.length > 7_000_000) {
      return errors.badRequest("Image too large (max ~5MB original)");
    }

    let context;
    try {
      context = await extractTripContext({
        imageUrl,
        imageBase64,
        imageMimeType,
        websiteText,
        userContext,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Vision call failed";
      console.error("[Extract] Gemini Vision error:", message);
      await logApiCall({
        apiName: "gemini",
        endpoint: "/api/ai/extract-trip-context",
        status: 503,
        responseTimeMs: Date.now() - startTime,
        cacheHit: false,
        costUsd: 0,
        error: message,
        metadata: { user_id: user?.id ?? "anonymous", is_anonymous: isAnonymous },
      });
      return errors.serviceUnavailable("Could not extract trip details. Try a different image or paste a URL.");
    }

    // Record the cookie counter on success only — failed extractions don't
    // burn quota, matching the generation path.
    if (isAnonymous) {
      await recordExtract();
    }

    await logApiCall({
      apiName: "gemini",
      endpoint: "/api/ai/extract-trip-context",
      status: 200,
      responseTimeMs: Date.now() - startTime,
      cacheHit: false,
      costUsd: 0.0008, // Flash multimodal, single short call
      metadata: {
        user_id: user?.id ?? "anonymous",
        is_anonymous: isAnonymous,
        destination_confidence: context.destinationConfidence,
        identified_destination: context.destination !== null,
        vibes_count: context.vibes.length,
        had_image: Boolean(imageUrl || imageBase64),
        had_website_text: Boolean(websiteText),
      },
    });

    return apiSuccess({ context });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("[Extract] Unexpected error:", message);
    return errors.internal(message, "ExtractTripContext");
  }
}
