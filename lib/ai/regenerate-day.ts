/**
 * A new plan for one day of a trip.
 */

import type { ItineraryDay, UserProfilePreferences, BudgetTier, TripPace } from "@/types";
import { generateActivityId } from "@/lib/utils/activity-id";
import { getPrompt } from "@/lib/prompts";
import { captureLLMGeneration, type GeminiUsageMetadata } from "@/lib/posthog/llm-analytics";
import { getModelForPurpose, getSiblingModel, thinkingConfigFor } from "@/lib/ai/model-router";
import { logCacheMetrics } from "@/lib/ai/cache-metrics";
import type { SupportedLanguage } from "@/lib/ai/language";
import { withDeduplication, getDayDedupKey } from "@/lib/gemini-dedup";
import { paceBudgetPromptClause } from "@/lib/trip/pace";
import { validateAndFixCoordinates } from "@/lib/trip/coordinate-fallback";
import { ACTIVITY_TYPES } from "@/lib/trip/activity-type";
import { planCurrency } from "@/lib/ai/assistant/plan-costs";
import {
  buildProfilePreferencesSection,
  buildSchedulingPreferencesSection,
  getLanguageInstruction,
} from "@/lib/ai/trip-prompt";
import {
  withRetries,
  modelUnavailable,
  type Attempt,
  MAX_RETRIES,
  genAI,
  withTimeout,
  AI_REQUEST_TIMEOUT_MS,
} from "./gemini-call";

/**
 * Regenerate a single day within an existing itinerary.
 *
 * Unlike `generateItinerary` (whole trip) and `regenerateSingleActivity`
 * (one activity), this produces a fresh ItineraryDay that complements the
 * surrounding days — different theme, no duplicate places, same vibe/budget.
 *
 * Pass `dayContext.surroundingDays` so the model can avoid repeating the
 * neighborhoods/places already in the trip. Pass `instructions` to nudge
 * the result (e.g., "make it more relaxed", "focus on food").
 */
export interface RegenerateDayParams {
  destination: string;
  dayNumber: number; // 1-indexed
  date: string; // YYYY-MM-DD — preserved on the output
  budgetTier: BudgetTier;
  pace: TripPace;
  vibes: string[];
  /** All other days in the trip (for context + dedup). Excludes the day being replaced. */
  surroundingDays: ItineraryDay[];
  /** Optional user-provided steering (e.g., "less walking", "focus on food"). */
  instructions?: string;
  profilePreferences?: UserProfilePreferences;
  language?: SupportedLanguage;
  /**
   * Trip's travel style — pass "backpacker" so the regenerated day
   * matches the rest of the trip (hostels, free activities, social);
   * without it a backpacker trip gets a classic day. Read from
   * trip_meta.travel_style at the call site. Defaults to "classic".
   */
  travelStyle?: "classic" | "backpacker";
}

export async function regenerateSingleDay(
  params: RegenerateDayParams & { userId?: string }
): Promise<ItineraryDay> {
  const dedupKey = getDayDedupKey({
    destination: params.destination,
    dayNumber: params.dayNumber,
    budgetTier: params.budgetTier,
    instructions: params.instructions,
  });
  return withDeduplication(dedupKey, () => regenerateSingleDayInternal(params));
}

function regenerateSingleDayInternal(
  params: RegenerateDayParams & { userId?: string }
): Promise<ItineraryDay> {
  return withRetries((retryCount) => dayAttempt(params, retryCount), {
    retrying: "day regeneration",
    gaveUp: "Failed to regenerate day after retries",
    unavailable: (error) => modelUnavailable("regenerate day", error),
  });
}

/** One attempt at a single day; the final retry asks the sibling model. */
async function dayAttempt(
  params: RegenerateDayParams & { userId?: string },
  retryCount: number
): Promise<Attempt<ItineraryDay>> {
  const startTime = performance.now();
  // day-regenerate → gemini-2.5-flash (balanced quality/cost for a single day).
  // The FINAL retry switches to the sibling model: the SAME model at a LOWER
  // temperature tends to reproduce the same malformed JSON, and a different
  // model also dodges model-specific 5xx outages.
  const modelName =
    retryCount >= MAX_RETRIES
      ? getSiblingModel(getModelForPurpose("day-regenerate"))
      : getModelForPurpose("day-regenerate");

  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      // Low temperature: day-regenerate is a utility call. The surrounding-days
      // context + existing-places exclusion list already push the new day away
      // from the one being replaced, and a low temperature keeps behavior
      // reproducible for debugging / E2E tests.
      temperature: retryCount > 0 ? 0.3 : 0.5,
      topP: 0.95,
      topK: 40,
      maxOutputTokens: 2048, // One day is ~500-800 tokens; this leaves headroom.
      responseMimeType: "application/json",
      // Thinking OFF, as in generateItineraryInternal and generateItineraryStream.
      // 2.5-flash thinks by default and thinking tokens count against
      // maxOutputTokens, so with thinking on the 2048 cap is spent thinking and
      // the visible JSON comes out cut mid-object. The sibling-model retry
      // handles genuinely bad output.
      thinkingConfig: thinkingConfigFor(modelName),
    },
  });

  // Build context strings from surrounding days
  const surroundingContext = params.surroundingDays
    .map(
      (d) =>
        `Day ${d.day_number} (${d.date}) — ${d.theme || "General"}: ${d.activities
          .map((a) => a.name)
          .join(", ")}`
    )
    .join("\n");

  const existingPlaces = Array.from(
    new Set(
      params.surroundingDays.flatMap((d) => d.activities.map((a) => a.name))
    )
  ).join(", ");
  // Priced like the rest of the trip.
  const currency = planCurrency(params.surroundingDays);

  const languageInstruction = getLanguageInstruction(params.language);
  const profileSection = buildProfilePreferencesSection(params.profilePreferences);
  const schedulingSection = buildSchedulingPreferencesSection(
    params.profilePreferences
  );

  const userPrompt = `${languageInstruction}Regenerate Day ${params.dayNumber} of a ${params.surroundingDays.length + 1}-day trip to ${params.destination}.

## What to Replace
- Day number: ${params.dayNumber}
- Date: ${params.date}
- This day will REPLACE the current Day ${params.dayNumber}. The other days remain unchanged.

## Surrounding Days (do NOT change these — only generate Day ${params.dayNumber})
${surroundingContext || "(no other days)"}

## Already-Visited Places (do NOT include any of these)
${existingPlaces || "(none)"}

## Trip Parameters
- Destination: ${params.destination}
- Budget Tier: ${params.budgetTier}
- Pace: ${params.pace}
- Vibes: ${params.vibes.join(", ") || "general"}
${params.travelStyle === "backpacker" ? `\n## BACKPACKER MODE\nThis is a backpacker trip. The replacement day must match the rest of the trip in style:\n- Hostels (not hotels), street food / markets / casual eateries\n- Free walking tours, viewpoints, parks, free museums\n- Public transit, walking, intercity buses (no taxis except safety)\n- At least one explicitly social activity (pub crawl, walking tour, hostel-organised event)\n- Avoid expensive guided tours and upscale dining\n` : ""}${params.instructions ? `\n## User Instructions for this day\n${params.instructions}\n` : ""}${profileSection}${schedulingSection}

## Required JSON Output

Return ONE day object (NOT an array) with this exact shape:

{
  "day_number": ${params.dayNumber},
  "date": "${params.date}",
  "theme": "A theme that complements but DIFFERS from the surrounding days",
  "activities": [
    {
      "time_slot": "morning",
      "start_time": "09:00",
      "duration_minutes": 120,
      "name": "Real Place Name",
      "type": "attraction",
      "description": "What to do here (2-3 sentences)",
      "location": "Neighborhood",
      "address": "Full street address",
      "coordinates": { "lat": 48.858370, "lng": 2.294481 },
      "official_website": "https://...",
      "estimated_cost": { "amount": 25, "currency": "${currency}", "tier": "moderate" },
      "tips": ["One tip"],
      "booking_required": false
    }
  ]
}

Rules:
1. Return ONLY the JSON object for the day. No markdown, no array, no extra text.
2. day_number MUST be exactly ${params.dayNumber}; date MUST be exactly "${params.date}".
3. Match the ${params.pace} pace: ${paceBudgetPromptClause(params.pace)}.
4. Do NOT include any place from the already-visited list.
5. Use PRECISE coordinates (6 decimal places).
6. Each activity's "type" is one of: ${ACTIVITY_TYPES.join(", ")}.`;

  const regenerateDaySystemPrompt = await getPrompt("regenerate_day");

  try {
    const result = await withTimeout(
      model.generateContent({
        contents: [
          { role: "user", parts: [{ text: regenerateDaySystemPrompt }] },
          {
            role: "model",
            parts: [
              {
                text: "Understood. I will return a single day object as valid JSON.",
              },
            ],
          },
          { role: "user", parts: [{ text: userPrompt }] },
        ],
      }),
      AI_REQUEST_TIMEOUT_MS,
      "Day regeneration"
    );

    const response = result.response;
    const text = response.text();
    const latencyMs = performance.now() - startTime;

    logCacheMetrics("regenerateSingleDay", response.usageMetadata, modelName);

    try {
      // Gemini occasionally wraps the day in an array even when asked not to.
      // Be lenient — accept either { day_number, ... } or [{ day_number, ... }].
      const parsed = JSON.parse(text) as ItineraryDay | ItineraryDay[];
      const day = Array.isArray(parsed) ? parsed[0] : parsed;

      if (!day || !day.activities || !Array.isArray(day.activities) || day.activities.length === 0) {
        throw new Error("Invalid day structure: missing activities");
      }

      // Force day_number and date to the requested values so the UI can
      // splice the result back in without checking the model's choice.
      day.day_number = params.dayNumber;
      day.date = params.date;

      // Stamp IDs on each activity so the UI's drag/edit code paths work.
      for (const activity of day.activities) {
        if (!activity.id) {
          activity.id = generateActivityId();
        }
      }

      // Reuse the trip-wide coordinate fixer for any missing lat/lng.
      const fixed = validateAndFixCoordinates([day], params.destination)[0];

      captureLLMGeneration({
        distinctId: params.userId || "anonymous",
        model: modelName,
        endpoint: "regenerateSingleDay",
        usageMetadata: response.usageMetadata as GeminiUsageMetadata,
        latencyMs,
        success: true,
        properties: {
          destination: params.destination,
          day_number: params.dayNumber,
          activities_count: fixed.activities.length,
          budget_tier: params.budgetTier,
          retry_count: retryCount,
        },
      }).catch(() => {});

      return { value: fixed };
    } catch (parseError) {
      (retryCount < MAX_RETRIES ? console.warn : console.error)(
        `Day regeneration JSON parse error (attempt ${retryCount + 1}):`,
        parseError instanceof Error ? parseError.message : "Unknown",
        // MAX_TOKENS here means the output cap was hit (e.g. spent on
        // thinking). Logged so a truncation is diagnosable from the logs
        // instead of inferred from the preview.
        "\nfinishReason:",
        response.candidates?.[0]?.finishReason ?? "unknown",
        "\nResponse preview:",
        text.substring(0, 500)
      );

      captureLLMGeneration({
        distinctId: params.userId || "anonymous",
        model: modelName,
        endpoint: "regenerateSingleDay",
        usageMetadata: response.usageMetadata as GeminiUsageMetadata,
        latencyMs,
        success: false,
        error: "JSON parse error",
        properties: {
          destination: params.destination,
          day_number: params.dayNumber,
          retry_count: retryCount,
        },
      }).catch(() => {});

      return { unusable: true };
    }
  } catch (error) {
    const latencyMs = performance.now() - startTime;

    console.error("Gemini API error during day regeneration:", error);

    captureLLMGeneration({
      distinctId: params.userId || "anonymous",
      model: modelName,
      endpoint: "regenerateSingleDay",
      latencyMs,
      success: false,
      error: error instanceof Error ? error.message : "Unknown API error",
      properties: {
        destination: params.destination,
        day_number: params.dayNumber,
        retry_count: retryCount,
      },
    }).catch(() => {});

    return { failed: error };
  }
}
