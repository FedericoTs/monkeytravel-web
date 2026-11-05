/**
 * A new activity to replace one in a plan, or several to choose from.
 */

import type { Activity, ItineraryDay, BudgetTier } from "@/types";
import { generateActivityId } from "@/lib/utils/activity-id";
import { getPrompt } from "@/lib/prompts";
import { captureLLMGeneration, type GeminiUsageMetadata } from "@/lib/posthog/llm-analytics";
import { getModelForPurpose } from "@/lib/ai/model-router";
import { logCacheMetrics } from "@/lib/ai/cache-metrics";
import type { SupportedLanguage } from "@/lib/ai/language";
import { withDeduplication, getActivityDedupKey } from "@/lib/gemini-dedup";
import { ACTIVITY_TYPES, normalizeActivityType } from "@/lib/trip/activity-type";
import { planCurrency } from "@/lib/ai/assistant/plan-costs";
import { getLanguageInstruction } from "@/lib/ai/trip-prompt";
import {
  withRetries,
  type Attempt,
  genAI,
  withTimeout,
  AI_REQUEST_TIMEOUT_MS,
  MAX_RETRIES,
} from "./gemini-call";

/**
 * Regenerate a single activity within an itinerary
 * Used when a user wants to replace one activity with a different suggestion
 */
export interface RegenerateActivityParams {
  destination: string;
  activityToReplace: Activity;
  dayContext: ItineraryDay;
  budgetTier: BudgetTier;
  existingActivityNames: string[];
  preferences?: {
    category?: "attraction" | "restaurant" | "activity" | "transport";
    similarTo?: boolean; // If true, generate something similar
  };
  language?: SupportedLanguage;
  /**
   * Trip's travel style — when "backpacker", the replacement is biased
   * toward hostel-friendly / budget / social options, so a hostel is not
   * swapped for, e.g., a boutique hotel. Read from trip_meta.travel_style
   * at the call site. Defaults to "classic".
   */
  travelStyle?: "classic" | "backpacker";
  /** The trip's diets (trip_meta.dietary): a replacement place to eat must suit them. */
  dietary?: string[];
}

// The activity regeneration prompt loads from the database via getPrompt();
// lib/prompts.ts holds the defaults.

export async function regenerateSingleActivity(
  params: RegenerateActivityParams & { userId?: string }
): Promise<Activity> {
  const dedupKey = getActivityDedupKey({
    destination: params.destination,
    activityName: params.activityToReplace.name,
    timeSlot: params.activityToReplace.time_slot,
    dayNumber: params.dayContext.day_number,
    budgetTier: params.budgetTier,
  });

  return withDeduplication(dedupKey, () =>
    regenerateSingleActivityInternal(params)
  );
}

/**
 * Internal activity regeneration function (without deduplication wrapper)
 */
function regenerateSingleActivityInternal(
  params: RegenerateActivityParams & { userId?: string }
): Promise<Activity> {
  return withRetries((retryCount) => activityAttempt(params, retryCount), {
    retrying: "activity regeneration",
    gaveUp: "Failed to regenerate activity after retries",
    unavailable: () => new Error("Failed to regenerate activity: AI service unavailable"),
  });
}

/** One attempt at a replacement activity; a retry runs at a lower temperature. */
async function activityAttempt(
  params: RegenerateActivityParams & { userId?: string },
  retryCount: number
): Promise<Attempt<Activity>> {
  const startTime = performance.now();
  // activity-regenerate → gemini-2.5-flash-lite (cheapest, single activity).
  const modelName = getModelForPurpose("activity-regenerate");

  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      // Low temperature: single-activity regenerate is a utility call, and two
      // clicks on the same activity should surface similar shapes. Variety
      // comes from the exclusion list of existing activity names in the prompt.
      temperature: retryCount > 0 ? 0.3 : 0.5,
      topP: 0.95,
      topK: 40,
      maxOutputTokens: 2048,
      responseMimeType: "application/json",
    },
  });

  const userPrompt = replacementPrompt(params);

  // Fetch regeneration prompt from database (with caching and fallback)
  const regenerateSystemPrompt = await getPrompt("activity_regeneration");

  try {
    const result = await withTimeout(
      model.generateContent({
        contents: [
          { role: "user", parts: [{ text: regenerateSystemPrompt }] },
          { role: "model", parts: [{ text: "Understood. I will generate a single replacement activity as valid JSON." }] },
          { role: "user", parts: [{ text: userPrompt }] },
        ],
      }),
      AI_REQUEST_TIMEOUT_MS,
      "Activity regeneration"
    );

    const response = result.response;
    const text = response.text();
    const latencyMs = performance.now() - startTime;

    // Log cache metrics for monitoring
    logCacheMetrics("regenerateSingleActivity", response.usageMetadata, modelName);

    try {
      const activity = asReplacement(JSON.parse(text));

      // Validate required fields
      if (!activity) {
        throw new Error("Invalid activity structure");
      }

      // Capture LLM analytics (fire and forget)
      captureLLMGeneration({
        distinctId: params.userId || "anonymous",
        model: modelName,
        endpoint: "regenerateSingleActivity",
        usageMetadata: response.usageMetadata as GeminiUsageMetadata,
        latencyMs,
        success: true,
        properties: {
          destination: params.destination,
          replaced_activity: params.activityToReplace.name,
          new_activity: activity.name,
          budget_tier: params.budgetTier,
          retry_count: retryCount,
        },
      }).catch(() => {});

      return { value: activity };
    } catch (parseError) {
      (retryCount < MAX_RETRIES ? console.warn : console.error)(
        `Activity regeneration JSON parse error (attempt ${retryCount + 1}):`,
        parseError instanceof Error ? parseError.message : "Unknown",
        "\nResponse preview:",
        text.substring(0, 300)
      );

      // Capture failed attempt analytics
      captureLLMGeneration({
        distinctId: params.userId || "anonymous",
        model: modelName,
        endpoint: "regenerateSingleActivity",
        usageMetadata: response.usageMetadata as GeminiUsageMetadata,
        latencyMs,
        success: false,
        error: "JSON parse error",
        properties: {
          destination: params.destination,
          retry_count: retryCount,
        },
      }).catch(() => {});

      return { unusable: true };
    }
  } catch (error) {
    const latencyMs = performance.now() - startTime;

    console.error("Gemini API error during activity regeneration:", error);

    // Capture API error analytics
    captureLLMGeneration({
      distinctId: params.userId || "anonymous",
      model: modelName,
      endpoint: "regenerateSingleActivity",
      latencyMs,
      success: false,
      error: error instanceof Error ? error.message : "Unknown API error",
      properties: {
        destination: params.destination,
        retry_count: retryCount,
      },
    }).catch(() => {});

    return { failed: error };
  }
}

/** What to ask for in place of an activity; `options` asks for that many, best first, in a JSON array. */
function replacementPrompt(params: RegenerateActivityParams, options?: number): string {
  const { activityToReplace, dayContext, existingActivityNames, preferences } = params;
  // Priced like the rest of the trip.
  const currency = activityToReplace.estimated_cost?.currency || planCurrency([dayContext]);

  const languageInstruction = getLanguageInstruction(params.language);

  return `${languageInstruction}Generate a replacement activity for a trip to ${params.destination}.

## Current Activity to Replace
- Name: ${activityToReplace.name}
- Type: ${activityToReplace.type}
- Time Slot: ${activityToReplace.time_slot}
- Start Time: ${activityToReplace.start_time}
- Duration: ${activityToReplace.duration_minutes} minutes
- Location: ${activityToReplace.location}

## Day Context
- Day Theme: ${dayContext.theme || "General exploration"}
- Date: ${dayContext.date}
- Other activities this day: ${dayContext.activities.filter(a => a.name !== activityToReplace.name).map(a => a.name).join(", ") || "None"}

## Constraints
- Budget Tier: ${params.budgetTier}
- Time Slot: ${activityToReplace.time_slot}
- Start Time: ${activityToReplace.start_time}
- Duration should be approximately: ${activityToReplace.duration_minutes} minutes
${preferences?.category ? `- Category preference: ${preferences.category}` : ""}
${preferences?.similarTo ? "- Should be similar in type/style to the replaced activity" : "- Should be different/fresh compared to the replaced activity"}
${params.travelStyle === "backpacker" ? `- BACKPACKER TRIP: prefer hostels (not hotels), street food / markets / casual eateries, free walking tours, viewpoints, public transit. Avoid expensive guided tours, taxis, and upscale dining. Favour social spots where solo travellers can meet others.` : ""}
${params.dietary?.length ? `- Diet: ${params.dietary.join(", ")}. A place to eat must suit it: a real, long-established place well known for it, not a new or little-known one.` : ""}

## Do NOT suggest any of these places (already in itinerary):
${existingActivityNames.join(", ")}

## Required JSON Output
${options ? `${options} different options, best first, as a JSON array of objects like this one:\n` : ""}{
  "time_slot": "${activityToReplace.time_slot}",
  "start_time": "${activityToReplace.start_time}",
  "duration_minutes": ${activityToReplace.duration_minutes},
  "name": "Real Place Name",
  "type": "${ACTIVITY_TYPES.join("|")}",
  "description": "What to do here (2-3 sentences)",
  "location": "Neighborhood or area name",
  "address": "Full street address",
  "coordinates": {
    "lat": 48.858370,
    "lng": 2.294481
  },
  "official_website": null,
  "estimated_cost": {
    "amount": 0,
    "currency": "${currency}",
    "tier": "free|budget|moderate|expensive"
  },
  "tips": ["Tip 1", "Tip 2"],
  "booking_required": false
}

Return ONLY the JSON ${options ? "array" : "object"}, no extra text.`;
}

/**
 * A replacement as the model wrote it, made an activity: its type one the app
 * knows, an id, and coordinates only when they are a real point. Null when it
 * lacks a name, a type or a time slot.
 */
function asReplacement(raw: unknown): Activity | null {
  const activity = raw as Activity | null;
  if (!activity?.name || !activity.type || !activity.time_slot) return null;
  activity.type = normalizeActivityType(activity.type, activity.name);
  activity.id = generateActivityId();
  if (
    activity.coordinates &&
    typeof activity.coordinates.lat === "number" &&
    typeof activity.coordinates.lng === "number" &&
    (activity.coordinates.lat < -90 || activity.coordinates.lat > 90 ||
     activity.coordinates.lng < -180 || activity.coordinates.lng > 180 ||
     activity.coordinates.lat === 0 && activity.coordinates.lng === 0)
  ) {
    activity.coordinates = undefined as unknown as typeof activity.coordinates;
  }
  return activity;
}

// The rules of the activity_regeneration prompt (lib/prompts.ts), for several options.
const REPLACEMENT_OPTIONS_SYSTEM = `You are MonkeyTravel AI. Suggest replacement activities for a travel itinerary.

## Rules
1. **Real Places Only**: Only suggest real, verifiable locations that exist and are open today. Each must be searchable on Google Maps.
2. **Avoid Duplicates**: Do not suggest any place already in the itinerary, and no place twice.
3. **Context Aware**: Each option should fit the time slot and day theme.
4. **Verifiable**: Include the full street address, and official_website when the place has one.
5. **GPS Coordinates**: Include accurate latitude/longitude. This is MANDATORY.

## Output Format
Return ONLY a valid JSON array of activities. No markdown, no extra text.`;

// The plan waits for the options, so they get less time than a swap the traveller asked for.
const REPLACEMENT_OPTIONS_TIMEOUT_MS = 20_000;

/**
 * A few activities to put in place of one, best first, from one call. The
 * check of a diet plan's places to eat (lib/places/places-to-eat.ts) takes the
 * first that is open and not in the plan yet: asked for one, the model offers a
 * place the plan already has now and then, however it is told not to.
 */
export async function replacementOptions(
  params: RegenerateActivityParams & { userId?: string },
  count = 3
): Promise<Activity[]> {
  const startTime = performance.now();
  const modelName = getModelForPurpose("activity-regenerate");
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: { temperature: 0.7, topP: 0.95, topK: 40, maxOutputTokens: 4096, responseMimeType: "application/json" },
  });
  const result = await withTimeout(
    model.generateContent({
      contents: [
        { role: "user", parts: [{ text: REPLACEMENT_OPTIONS_SYSTEM }] },
        { role: "model", parts: [{ text: "Understood. I will give the options as a valid JSON array." }] },
        { role: "user", parts: [{ text: replacementPrompt(params, count) }] },
      ],
    }),
    REPLACEMENT_OPTIONS_TIMEOUT_MS,
    "Replacement options"
  );
  const response = result.response;
  logCacheMetrics("replacementOptions", response.usageMetadata, modelName);
  const parsed: unknown = JSON.parse(response.text());
  const options = (Array.isArray(parsed) ? parsed : [parsed]).map(asReplacement).filter((a): a is Activity => a !== null);
  captureLLMGeneration({
    distinctId: params.userId || "anonymous",
    model: modelName,
    endpoint: "replacementOptions",
    usageMetadata: response.usageMetadata as GeminiUsageMetadata,
    latencyMs: performance.now() - startTime,
    success: options.length > 0,
    properties: {
      destination: params.destination,
      replaced_activity: params.activityToReplace.name,
      options: options.map((a) => a.name),
    },
  }).catch(() => {});
  return options;
}
