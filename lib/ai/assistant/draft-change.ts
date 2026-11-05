import type { GoogleGenerativeAI } from "@/lib/ai/genai-compat";
import type { SupportedLanguage } from "@/lib/ai/language";
import { lockedActivityNames } from "@/lib/ai/anchors-core";
import { chatLanguageInstruction } from "@/lib/ai/assistant/chat-language";
import { normalizeDraftDays } from "@/lib/ai/assistant/structural";
import { logCacheMetrics } from "@/lib/ai/cache-metrics";
import { getModelForPurpose } from "@/lib/ai/model-router";
import { validateAndFixCoordinates } from "@/lib/trip/coordinate-fallback";
import type { ItineraryDay, StructuredAssistantResponse } from "@/types";

type AssistantAction = NonNullable<StructuredAssistantResponse["action"]>;

/**
 * The trip assistant's pasted draft (structural): the user pasted a multi-day
 * plan ("rearrange as per my own draft", "update all days according to my
 * input"), which the single-activity tools could only mangle. The model maps
 * the draft onto the trip's CURRENT days, and the result is ONE multi-day
 * change for the user's confirm. It never changes the trip's length (that is
 * "add a day").
 *
 * The outcome is the prepared days (`action`), a refusal or failure
 * (`error`), or a `note` for the reply when no day could be mapped.
 * `unmapped` lists the current days the draft did not cover: they stay as
 * they are, and the reply must say so.
 */
export async function prepareDraftChange(input: {
  days: ItineraryDay[];
  destination: string;
  message: string;
  language: SupportedLanguage;
  genAI: GoogleGenerativeAI;
}): Promise<{ action?: AssistantAction; error?: string; note?: string; unmapped: number[] }> {
  const { days, destination, message, language, genAI } = input;
  const lockedAcrossTrip = days.flatMap((d) => lockedActivityNames(d));

  if (days.length === 0) {
    return { error: "This trip has no itinerary days yet, so there is nothing to revise", unmapped: [] };
  } else if (lockedAcrossTrip.length > 0) {
    // apply_draft rewrites whole days in bulk, which would erase anchors.
    // Deliberately does NOT point at the wizard's "Paste a plan" import:
    // that panel only exists on step 1, before the trip is saved, so on a
    // saved trip it would be a door that isn't there. Offer what actually
    // works today — per-day edits on the unpinned days.
    console.log(`[AI Assistant] Refused apply_draft on anchored trip (${lockedAcrossTrip.length} locked)`);
    return {
      error: `This trip is built around fixed plans (${lockedAcrossTrip.slice(0, 3).join(", ")}), so I won't rewrite it wholesale from a pasted draft. Tell me what to change on a specific day and I'll do that instead.`,
      unmapped: [],
    };
  } else {
    console.log(`[AI Assistant] Attempting to map pasted draft onto ${days.length} days`);
    try {
      const draftModel = genAI.getGenerativeModel({
        model: getModelForPurpose("assistant-optimize"),
        generationConfig: {
          temperature: 0.4,
          // Up to 14 revised days.
          maxOutputTokens: 16384,
          responseMimeType: "application/json",
        },
      });

      const currentDaysCompact = days.map((d) => ({
        day_number: d.day_number,
        date: d.date,
        ...(d.city ? { city: d.city } : {}),
        theme: d.theme || "",
        activities: d.activities.map((a) => ({
          name: a.name,
          start_time: a.start_time,
          duration_minutes: a.duration_minutes,
          type: a.type,
          location: a.location,
        })),
      }));

      const draftPrompt = `You are revising a ${days.length}-day trip itinerary for ${destination} according to a draft plan the user pasted.${chatLanguageInstruction(language)}

CURRENT ITINERARY (day_number and date are FIXED):
${JSON.stringify(currentDaysCompact, null, 1)}

USER'S MESSAGE (their draft/instructions):
${message}

Map the user's draft onto the CURRENT days. Rules:
1. Only use existing day_numbers (1-${days.length}). NEVER invent new days or change dates.
2. Return ONLY the days the draft actually covers — days you cannot confidently map stay untouched (list them in unmappedDayNumbers).
3. When the draft references an activity that already exists in the itinerary, reuse its EXACT current name so it can be re-linked.
4. Each revised day needs 2-6 activities with realistic times, in the user's requested order.
5. If the message is NOT actually a revised plan (e.g. just a question that mentions several days), return {"revisedDays": [], "unmappedDayNumbers": [], "note": "not a draft"}.

Return ONLY valid JSON:
{
  "revisedDays": [
    {
      "day_number": 1,
      "theme": "Short theme for the day",
      "activities": [
        {
          "name": "Real Place Name",
          "type": "attraction",
          "description": "2-3 sentence description",
          "location": "Neighborhood",
          "address": "Street address if known",
          "start_time": "09:00",
          "duration_minutes": 120,
          "estimated_cost": { "amount": 20, "currency": "EUR", "tier": "moderate" },
          "tips": ["One tip"],
          "booking_required": false
        }
      ]
    }
  ],
  "unmappedDayNumbers": [4, 5],
  "note": "One short sentence on anything you could not map"
}`;

      const draftResult = await draftModel.generateContent(draftPrompt);
      const draftText = draftResult.response.text();

      // Wire prompt-cache hit-rate monitoring (see lib/ai/cache-metrics.ts). The
      // draft prompt is per-user content-heavy, so expect ~0% hits —
      // logged anyway so the call site shows up in cost dashboards.
      logCacheMetrics("ai.assistant.apply_draft", draftResult.response.usageMetadata);

      const draftJson = draftText.match(/\{[\s\S]*\}/);
      if (!draftJson) {
        throw new Error("Draft mapping returned no JSON");
      }
      const parsedDraft = JSON.parse(draftJson[0]) as {
        revisedDays?: unknown;
        note?: string;
      };

      // Pure validation/normalization (day_number whitelist, pinned
      // date/city, id carryover by name, generateActivityId for new
      // ones) — see lib/ai/assistant/structural.ts.
      const normalized = normalizeDraftDays(parsedDraft.revisedDays, days);

      if (normalized.days.length === 0) {
        return {
          note: "The user's message looked like a pasted multi-day draft, but none of its days could be mapped onto the current trip. NO change was made. Ask them to label days as 'Day 1', 'Day 2', … matching the trip's current days.",
          unmapped: [],
        };
      } else {
        // Same coordinate backfill the generators use (lib/gemini.ts).
        const fixedDays = validateAndFixCoordinates(
          normalized.days,
          destination
        );

        const action: AssistantAction = {
          type: "apply_draft",
          applied: false,
          dayNumber: normalized.changedDayNumbers[0],
          dayCount: normalized.changedDayNumbers.length,
          revisedDays: fixedDays,
        };
        console.log(`[AI Assistant] Prepared draft revision of days ${normalized.changedDayNumbers.join(", ")}`);
        return { action, unmapped: normalized.unmappedDayNumbers };
      }
    } catch (err) {
      console.error("[AI Assistant] Failed to map draft:", err);
      // The reply tells the user this reason, so the error's own text stays in the log.
      return { error: "The pasted draft could not be matched to the trip's days just now", unmapped: [] };
    }
  }
}
