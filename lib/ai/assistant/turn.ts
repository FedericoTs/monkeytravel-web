import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveAiLanguage, tripLocale, type SupportedLanguage } from "@/lib/ai/language";
import { readLocaleCookie } from "@/lib/ai/user-context";
import { ASSISTANT_FORBIDDEN_MESSAGE, resolveAssistantRole } from "@/lib/ai/assistant-access";
import { ASSISTANT_ERROR_CODES } from "@/lib/ai/assistant/error-message";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { readJsonBody } from "@/lib/api/json-body";
import { requireRow } from "@/lib/api/require-row";
import { errors } from "@/lib/api/response-wrapper";
import { blockedCall, checkApiAccess } from "@/lib/api-gateway";
import { logReadError } from "@/lib/supabase/log-read-error";
import { TRIP_COLUMNS } from "@/lib/trips/columns";
import { checkUsageLimit } from "@/lib/usage-limits";
import type { ItineraryDay } from "@/types";

/** What the trip page's assistant is sent. */
export interface AssistantRequest {
  tripId: string;
  message: string;
  conversationId?: string;
  itinerary?: ItineraryDay[]; // Current itinerary for modifications
  display?: unknown; // The currency the page shows prices in (readDisplayCurrency)
}

/**
 * Get the user's preferred language from cookies or profile
 */
async function getUserLanguage(
  supabase: SupabaseClient,
  userId: string
): Promise<SupportedLanguage> {
  const fromCookie = await readLocaleCookie();
  if (fromCookie) return fromCookie;

  try {
    const { data: profile } = logReadError("assistant: preferred language", await supabase
      .from("users")
      .select("preferred_language")
      .eq("id", userId)
      .single());

    if (profile?.preferred_language) {
      return resolveAiLanguage(profile.preferred_language);
    }
  } catch {
    // Ignore errors
  }

  return "en";
}

/**
 * The checks every trip-assistant turn passes before any work, in order: a
 * signed-in caller, a trip id and a message, the AI kill switch, the daily
 * message limit, and a trip the caller may edit. Returns the refusal, or who
 * asks about which trip and the language to answer in: the trip's own when it
 * has one, else the visitor's.
 */
export async function readAssistantTurn(request: NextRequest, requestStartTime: number) {
  const { user, supabase, errorResponse } = await getAuthenticatedUser();
  if (errorResponse) return { refused: errorResponse };

  // Get user's preferred language for AI content localization
  // Where the visitor is browsing from; replaced by the trip's own language
  // once the trip is loaded (Phase 1.3).
  let userLanguage = await getUserLanguage(supabase, user.id);
  console.log(`[AI Assistant] User language: ${userLanguage}`);

  const { body, invalidBody } = await readJsonBody<AssistantRequest>(request);
  if (invalidBody) return { refused: invalidBody };
  const { tripId, message, itinerary: clientItinerary } = body;

  console.log(`[AI Assistant] Message: "${message}"`);
  console.log(`[AI Assistant] Trip ID: ${tripId}`);
  console.log(`[AI Assistant] Client itinerary provided: ${!!clientItinerary}`);

  if (!tripId || !message) {
    return { refused: errors.badRequest("Missing tripId or message") };
  }

  // Check API access control
  const access = await checkApiAccess("gemini");
  if (!access.allowed) {
    return { refused: await blockedCall(access, {
      apiName: "gemini",
      endpoint: "/api/ai/assistant",
      startTime: requestStartTime,
      metadata: { user_id: user.id, trip_id: tripId },
      disabled: "AI assistant is currently disabled",
    }) };
  }

  // Check usage limits (daily limit for assistant messages)
  const usageCheck = await checkUsageLimit(user.id, "aiAssistantMessages", user.email);
  if (!usageCheck.allowed) {
    return { refused: errors.rateLimit(
      usageCheck.message || "Daily AI assistant message limit reached.",
      { usage: usageCheck, upgradeUrl: "/pricing" }
    ) };
  }

  // Fetch trip data. RLS decides whether the caller can see it; the owner
  // and invited editors may use the assistant (lib/ai/assistant-access.ts).
  // This used to filter on user_id = caller, so every collaborator's first
  // message answered "Trip not found".
  const { row: trip, errorResponse: tripError } = await requireRow("trip", supabase
    .from("trips")
    .select(TRIP_COLUMNS)
    .eq("id", tripId)
    .single(), "Trip not found");
  if (tripError) return { refused: tripError };

  const assistantRole = await resolveAssistantRole(supabase, trip, user.id);
  if (!assistantRole) {
    return { refused: errors.forbidden(ASSISTANT_FORBIDDEN_MESSAGE, ASSISTANT_ERROR_CODES.notAllowed) };
  }
  // This route never writes the trip: it prepares a change and returns it as
  // a pendingChange. The change lands only through /apply, which checks the
  // role, the fixed plans and the itinerary version again.

  // Phase 1.3: an existing trip is edited in ITS language, not the
  // language of the tab the owner opened it from. Older trips without
  // the stamp keep the cookie/profile resolution above.
  userLanguage = tripLocale(trip.trip_meta) ?? userLanguage;

  return { user, supabase, body, usageCheck, trip, assistantRole, userLanguage };
}
