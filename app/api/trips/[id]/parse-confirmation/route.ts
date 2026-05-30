/**
 * POST /api/trips/[id]/parse-confirmation
 *
 * F2.simple — Paste a booking confirmation email body, get back a typed
 * ParsedBooking the UI can preview before turning into a trip activity.
 *
 * Strategic guardrails:
 * - Owner-only. Collaborators don't add bookings (per spec); they would
 *   need to send confirmations to the owner. Avoids RLS/UX edge cases
 *   while the feature is behind a flag.
 * - Per-IP rate limit (20/min) — Gemini is the bottleneck and we want
 *   the credit-card-DoS floor before any quota check, since the limiter
 *   short-circuits before we even resolve `auth.getUser()`.
 * - User-level quota: reuse `aiAssistantMessages` (daily bucket, 20/day
 *   on free tier). This is the cheapest existing bucket — adding a new
 *   one would mean a migration + dashboard update for a feature that's
 *   off by default. Per-message cost is comparable to the AI assistant.
 *
 * Returns:
 *   200 { parsed: ParsedBooking }
 *   200 { error: 'too_short' | 'no_booking_found' | 'parse_failed' }
 *   401 unauthorized
 *   403 not the trip owner
 *   404 trip not found
 *   413 payload too large (>50 KB body — sanity check before strip)
 *   429 rate-limited
 *
 * The user-facing 'error' codes intentionally come back as 200 so the
 * UI doesn't have to translate them from HTTP status — the modal renders
 * "couldn't find a booking" vs "paste more text" vs "try again" based
 * purely on the error tag.
 */

import { NextRequest } from "next/server";
import { getAuthenticatedUser, verifyTripOwnership } from "@/lib/api/auth";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { createRateLimiter } from "@/lib/api/rate-limit";
import { checkUsageLimit, incrementUsage } from "@/lib/usage-limits";
import { extractBooking, isParseError } from "@/lib/email-parse/extract";
import type { TripRouteContext } from "@/lib/api/route-context";

// 20 parses / min / IP — generous for a human pasting a sequence of
// confirmations, low enough to keep a scripted attacker off the Gemini
// bill. The Gemini call is the bottleneck (~$0.001 per call at current
// flash pricing), so this is the hard cost ceiling.
const limiter = createRateLimiter("email-parse", 20, 60_000);

// Hard cap on the request body. Real confirmation emails are 5-30 KB
// after Resend/Gmail wrapping; 50 KB gives plenty of headroom while
// stopping a megabyte-sized payload from ever reaching Gemini's
// preprocessing.
const MAX_REQUEST_BYTES = 50_000;

export async function POST(request: NextRequest, context: TripRouteContext) {
  try {
    // Rate limit FIRST — before any DB hit. The limiter is cheap and
    // its job is to protect downstream cost (Gemini + Supabase).
    const { allowed } = await limiter.check(request);
    if (!allowed) {
      return errors.rateLimit(
        "Too many parse requests. Please wait a minute and try again.",
        { retryAfterSeconds: 60 }
      );
    }

    const { id: tripId } = await context.params;

    // Auth.
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // Authorize: trip owner only. Collaborators may VIEW but not add
    // bookings here — keeps the surface area small while the feature
    // is behind NEXT_PUBLIC flag and we're learning the right model.
    const { errorResponse: tripError } = await verifyTripOwnership(
      supabase,
      tripId,
      user.id
    );
    if (tripError) return tripError;

    // User-level cost guard. Free tier gets 20 AI-assistant-messages/day,
    // shared across the in-trip assistant and now email parses. We
    // intentionally do NOT use aiGenerations (3/month) — that bucket is
    // for *whole trips*, and using it here would force users to choose
    // between parsing a confirmation and generating a new trip.
    const usage = await checkUsageLimit(user.id, "aiAssistantMessages", user.email);
    if (!usage.allowed) {
      return errors.forbidden(
        usage.message || "Daily AI quota reached. Please try again tomorrow.",
        "USAGE_LIMIT_REACHED"
      );
    }

    // Parse + validate body.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errors.badRequest("Invalid JSON body");
    }
    const emailBody =
      body && typeof body === "object" && "emailBody" in body
        ? (body as { emailBody: unknown }).emailBody
        : undefined;
    if (typeof emailBody !== "string") {
      return errors.badRequest("emailBody must be a string");
    }
    if (emailBody.length > MAX_REQUEST_BYTES) {
      return errors.badRequest(
        `Email body too large (${emailBody.length} chars, max ${MAX_REQUEST_BYTES}).`
      );
    }

    // Call Gemini via the extractor.
    const result = await extractBooking(emailBody);

    if (isParseError(result)) {
      // Return as 200 with an error tag (see file header) — UI keys on
      // result.error for messaging. We intentionally do NOT increment
      // the usage counter for 'too_short' (we never called Gemini) but
      // DO increment for 'parse_failed' / 'no_booking_found' (Gemini
      // call did happen and incurred cost).
      if (result.error !== "too_short") {
        // Fire and forget — never let a usage-increment failure break the
        // user-facing response.
        void incrementUsage(user.id, "aiAssistantMessages").catch((err) => {
          console.error(
            "[parse-confirmation] usage increment failed",
            err
          );
        });
      }
      return apiSuccess({ ...result });
    }

    // Success — increment the daily counter and return the parsed booking.
    void incrementUsage(user.id, "aiAssistantMessages").catch((err) => {
      console.error("[parse-confirmation] usage increment failed", err);
    });

    return apiSuccess({ parsed: result });
  } catch (error) {
    console.error("[parse-confirmation] unexpected error", error);
    return errors.internal("Failed to parse email", "parse-confirmation");
  }
}
