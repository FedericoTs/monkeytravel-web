import { NextRequest } from "next/server";
import { LANGUAGE_NAMES, type SupportedLanguage } from "@/lib/ai/language";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { GoogleGenerativeAI } from "@/lib/ai/genai-compat";
import { regenerateSingleDay } from "@/lib/gemini";
import { validateAndFixCoordinates } from "@/lib/trip/coordinate-fallback";
import { logCacheMetrics } from "@/lib/ai/cache-metrics";
import {
  detectStructuralIntent,
  normalizeDraftDays,
  nextDateISO,
  computeExtendedEndDate,
  MAX_TRIP_DAYS,
} from "@/lib/ai/assistant/structural";
import {
  classifyTask,
  selectModel,
  estimateCost,
} from "@/lib/ai/config";
import { getModelForPurpose } from "@/lib/ai/model-router";
import { lockedActivityNames } from "@/lib/ai/anchors-core";
import { recordUsage } from "@/lib/ai/usage";
import { incrementUsage } from "@/lib/usage-limits";
import { recordAiOutcome } from "@/lib/ai/observability";
import { getTripDestination } from "@/lib/trips/destination";
import {
  isTripVibe,
  type BudgetTier,
  type ItineraryDay,
  type AssistantCard,
  type StructuredAssistantResponse,
} from "@/types";
import {
  type Coordinates,
} from "@/lib/utils/geo";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { destinationCityTerm } from "@/lib/api/postgrest-filter";
import { ACTIVITY_TYPES } from "@/lib/trip/activity-type";
import { dietsFrom } from "@/lib/trips/diet";
import { placesToEatCheck } from "@/lib/places/places-to-eat";
import { ASSISTANT_SURFACE, isConciergeRow } from "@/lib/ai/conversations";
import { applyButtonLabel } from "@/lib/ai/assistant/apply-button";
import {
  announcesProposal,
  claimsItineraryChange,
  claimsToRemember,
  nothingChangedReply,
  nothingKeptReply,
  pendingChangeNote,
  preparedChangeReply,
} from "@/lib/ai/assistant/honesty";
import {
  conversationTurns,
  proposeTripEdits,
  readDisplayCurrency,
  type TripEditProposal,
} from "@/lib/ai/assistant/trip-edits";
import { logWriteError } from "@/lib/supabase/log-write-error";
import { isNoRow } from "@/lib/supabase/no-row";
import { readAssistantTurn } from "@/lib/ai/assistant/turn";
import { pendingChangeFor } from "@/lib/ai/assistant/pending-change";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || "");

/**
 * The assistant's language line: shorter than the trip prompt's
 * getLanguageInstruction (lib/ai/trip-prompt.ts), which also sets formats.
 */
function chatLanguageInstruction(language: SupportedLanguage): string {
  if (language === "en") return "";

  const instructions: Record<Exclude<SupportedLanguage, "en">, string> = {
    es: `\n\nIMPORTANTE: Responde COMPLETAMENTE en espanol. Los nombres de actividades, descripciones, consejos y el resumen deben estar en espanol.`,
    it: `\n\nIMPORTANTE: Rispondi COMPLETAMENTE in italiano. I nomi delle attivita, le descrizioni, i consigli e il riepilogo devono essere in italiano.`,
    pt: `\n\nIMPORTANTE: Responda COMPLETAMENTE em português. Os nomes das atividades, descrições, dicas e o resumo devem estar em português.`,
  };

  return instructions[language];
}

/** The chat reply follows the traveller; itinerary text keeps the trip's language. */
function replyLanguageRule(tripLanguage: SupportedLanguage): string {
  return `\n\nREPLY LANGUAGE: write your chat reply in the same language as the user's latest message. Itinerary text you write (activity names, descriptions, tips) stays in ${LANGUAGE_NAMES[tripLanguage]}.`;
}

// Types for the assistant
interface AssistantMessage {
  role: "user" | "assistant";
  content: string;
  /**
   * The model's reply claimed a change that was not saved, and the honesty
   * guard replaced it (lib/ai/assistant/honesty.ts). Kept so the rate can be
   * read back from ai_conversations.
   */
  guarded?: boolean;
  /**
   * That the change waits for the Apply button. Beside the reply, not in it:
   * the chat shows it only while the change waits (AIAssistantEnhanced).
   */
  pendingNote?: string;
  cards?: AssistantCard[];
  action?: {
    type: string;
    /**
     * TRUE only when a database write for this change SUCCEEDED on this
     * request. It was previously a literal `true` written at construction
     * time, before any write was attempted, so it was a constant rather than
     * a fact — 158 of 161 recorded actions said `applied: true` while users
     * were telling us in the same thread that nothing had changed.
     */
    applied: boolean;
    /**
     * The change is prepared and waiting for the user to tap Apply. Nothing
     * is saved. `applied` and `pending` are never both true.
     */
    pending?: boolean;
    activityId?: string;
    dayNumber?: number;
    // apply_draft: number of days revised — the client badge renders
    // "{count} days updated" from this (metadata, never model prose).
    dayCount?: number;
  };
  timestamp: string;
}

interface TripContext {
  id: string;
  title: string;
  destination: string;
  startDate: string;
  endDate: string;
  budget?: { total: number; currency: string };
  itinerary: ItineraryDay[];
  dayCount: number;
  activityCount: number;
}

/**
 * What the model is allowed to tell the user about a prepared change. Nothing
 * is saved until the user confirms it on the card, so the reply must not say
 * it is done. Every action type goes through here.
 */
function pendingActionContext(change: string, buttonLabel: string): string {
  return `
IMPORTANT - NOTHING HAS BEEN SAVED. The user's itinerary is UNCHANGED.
What is prepared: ${change}.
A card sits directly below your reply with a button labelled "${buttonLabel}".
The change happens only when the user taps it.
Say in ONE short sentence what you have lined up, then tell them to tap
"${buttonLabel}" below. Use those exact words for the button, so a distracted
reader does not have to work out which control you mean.
NEVER say it is done, made, added, replaced, removed, moved, updated, changed
or saved. Never use the past tense about their itinerary.`;
}

/** One plain-language phrase naming the change, for the frame above. */
function describeChange(action: NonNullable<StructuredAssistantResponse["action"]>): string {
  const day = action.dayNumber;
  switch (action.type) {
    case "add_day": {
      const nd = action.newDay;
      if (!nd) return `add a new Day ${day}`;
      const theme = nd.theme ? ` themed "${nd.theme}"` : "";
      return `add a new Day ${day} (${nd.date})${theme} with: ${nd.activities.map((a) => a.name).join(", ")}`;
    }
    case "apply_draft": {
      const days = (action.revisedDays ?? []).map((d) => d.day_number).join(", ");
      return days ? `rewrite Day(s) ${days} from the draft they pasted` : `rewrite days from the draft they pasted`;
    }
    default:
      return `change Day ${day}`;
  }
}


// Build system prompt for structured responses
function buildSystemPrompt(tripContext: TripContext): string {
  return `You are MonkeyTravel's AI assistant - concise, helpful, and action-oriented.

TRIP CONTEXT:
- Destination: ${tripContext.destination}
- Dates: ${tripContext.startDate} to ${tripContext.endDate} (${tripContext.dayCount} days)
- Activities: ${tripContext.activityCount} planned
${tripContext.budget ? `- Budget: ${tripContext.budget.currency} ${tripContext.budget.total}` : ""}

CURRENT ITINERARY:
${tripContext.itinerary.map((day) => `Day ${day.day_number}: ${day.activities.map((a) => `${a.name} (${a.type})`).join(", ")}`).join("\n")}

RESPONSE FORMAT - Return valid JSON only:
{
  "summary": "Brief 1-2 sentence response",
  "cards": [
    // Optional array of cards for rich display
  ]
}

NEVER include an "action" object. Whether the itinerary actually changed is
decided by this system, not by you, and is attached to your reply
automatically. Emitting one produced 12 recorded "removals" that never
happened.

NEVER state or imply in "summary" that anything has been added, replaced,
removed, moved, updated, changed or saved UNLESS a NOTE below explicitly tells
you it was saved. With no such NOTE, you have changed nothing — answer the
question or describe what you would do, in the present or future tense.

CARD TYPES:
1. tip: { "type": "tip", "icon": "lightbulb|warning|info|clock|money|weather", "title": "...", "content": "..." }
2. comparison: { "type": "comparison", "title": "...", "options": [{"name": "", "pros": [], "cons": [], "recommended": true}] }
3. confirmation: { "type": "confirmation", "icon": "check|swap|plus|trash", "title": "...", "description": "..." }

ACTIVITY OBJECT FORMAT:
{
  "id": "act_<unique suffix>",
  "time_slot": "morning|afternoon|evening",
  "start_time": "HH:MM",
  "duration_minutes": 60-180,
  "name": "Activity Name",
  "type": "${ACTIVITY_TYPES.join("|")}",
  "description": "Brief description",
  "location": "Neighborhood/Area",
  "estimated_cost": { "amount": number, "currency": "local currency code", "tier": "budget|moderate|expensive" },
  "tips": ["tip1"],
  "booking_required": false
}

GUIDELINES:
- Be CONCISE - summaries should be 1-2 sentences max
- NEVER put JSON, code blocks, field names or an activity object in "summary".
  It is read by a person on a phone. The change itself is rendered for them
  from real data; describing it in prose is all you are asked for. (This rule
  replaces one telling you to "ALWAYS include the full new activity object" —
  with the action object removed from your reply, that instruction made the
  model paste raw JSON into the chat.)
- Use cards to show structured info instead of long text
- For tips/advice, use tip cards with appropriate icons
- For comparisons, use comparison cards with pros/cons
- Keep the trip's existing style and budget level in mind`;
}

export async function POST(request: NextRequest) {
  const requestStartTime = Date.now();
  console.log("[AI Assistant] POST request received");

  try {
    // Who asks about which trip, and in which language; or the refusal.
    const turn = await readAssistantTurn(request, requestStartTime);
    if (turn.refused) return turn.refused;
    const { user, supabase, body, usageCheck, trip, assistantRole, userLanguage } = turn;
    const { tripId, message, conversationId, itinerary: clientItinerary } = body;

    // Use client itinerary if provided (for real-time edits), otherwise use DB
    const itinerary = (clientItinerary || trip.itinerary || []) as ItineraryDay[];
    console.log(`[AI Assistant] Itinerary has ${itinerary.length} days`);

    // Prefer trip_meta.destination (canonical) over title-strip — see
    // lib/trips/destination.ts. The AI assistant's quality depends on
    // this string being correct (it's used to look up coordinates AND
    // passed into the AI's tripContext below).
    const destinationName = getTripDestination(trip);
    let destinationCoords: Coordinates | undefined;

    // City part only, escaped, matched EXACTLY (case-insensitive, no
    // wildcards). The raw "Chennai, India" put a comma inside or(), which
    // PostgREST read as a second condition and answered 400, so the assistant
    // got no coordinates for any "City, Country" destination. A %city% match
    // would be worse than none: "Nice" is inside "Venice". Multi-city labels
    // yield no term (lib/api/postgrest-filter.ts). maybeSingle: no match is a
    // normal outcome, not a 406.
    const cityTerm = destinationCityTerm(destinationName);
    const { data: destData } = cityTerm
      ? await supabase
          .from("destinations")
          .select("latitude, longitude")
          .or(`name.ilike.${cityTerm},city.ilike.${cityTerm}`)
          .not("latitude", "is", null)
          .not("longitude", "is", null)
          .limit(1)
          .maybeSingle()
      : { data: null };

    if (destData?.latitude && destData?.longitude) {
      destinationCoords = { lat: destData.latitude, lng: destData.longitude };
      console.log(`[AI Assistant] Destination coordinates: ${destinationCoords.lat}, ${destinationCoords.lng}`);
    } else {
      console.log(`[AI Assistant] No coordinates found for destination: ${destinationName}`);
    }

    const tripContext: TripContext = {
      id: trip.id,
      title: trip.title,
      destination: destinationName,  // same canonical value resolved above
      startDate: trip.start_date,
      endDate: trip.end_date,
      budget: trip.budget,
      itinerary,
      dayCount: itinerary.length,
      activityCount: itinerary.reduce((sum, day) => sum + day.activities.length, 0),
    };

    // Load conversation. Before the intents: the edit engine below reads it.
    // A concierge row, or one that's gone, starts a new thread.
    let conversation: { id: string; messages: AssistantMessage[] } | null = null;

    if (conversationId) {
      const { data: existingConvo, error: convoError } = await supabase
        .from("ai_conversations")
        .select("*")
        .eq("id", conversationId)
        .eq("user_id", user.id)
        .single();

      // A refused read is not a missing thread: answering anyway would fork it.
      if (convoError && !isNoRow(convoError)) throw convoError;
      if (existingConvo && !isConciergeRow(existingConvo.context)) {
        conversation = { id: existingConvo.id, messages: existingConvo.messages as AssistantMessage[] };
      }
    }
    if (!conversation) {
      const { data: newConvo, error: newConvoError } = await supabase
        .from("ai_conversations")
        .insert({ user_id: user.id, trip_id: tripId, messages: [], context: { surface: ASSISTANT_SURFACE } })
        .select()
        .single();
      // Without a thread the reply could not be kept.
      if (newConvoError) throw newConvoError;

      conversation = { id: newConvo?.id || "", messages: [] };
    }

    // STRUCTURAL intents first (add_day / apply_draft). See
    // lib/ai/assistant/structural.ts.
    const structuralIntent = detectStructuralIntent(message);

    // Then the wizard's edit engine (lib/ai/assistant/trip-edits.ts), which
    // makes the edits asked for in any words, several in one message, and
    // answers questions with the plan's figures. The chat runs when it fails.
    // It adds days too, as many as asked; add_day below appends one, and runs
    // only when the engine can't.
    let tripEdits: TripEditProposal | null = null;
    if (structuralIntent.type !== "apply_draft" && itinerary.length > 0) {
      try {
        tripEdits = await proposeTripEdits({
          message,
          destination: tripContext.destination,
          tripTitle: trip.title,
          days: itinerary,
          startDate: trip.start_date,
          endDate: trip.end_date,
          locale: userLanguage,
          history: conversationTurns(conversation.messages),
          display: readDisplayCurrency(body.display),
          canAddDays: assistantRole === "owner",
        });
      } catch (err) {
        console.error("[AI Assistant] Edit engine failed, using the chat:", err);
      }
    }
    const engineEdited = (tripEdits?.revisedDays.length ?? 0) > 0;

    console.log(
      `[AI Assistant] Structural intent: ${structuralIntent.type}; engine: ${tripEdits ? `${tripEdits.revisedDays.length} day(s)` : "not used"}`
    );

    // Deep clone the itinerary to avoid reference issues
    const modifiedItinerary: ItineraryDay[] = JSON.parse(JSON.stringify(itinerary));
    let actionTaken: StructuredAssistantResponse["action"] | undefined;
    let replacementError: string | undefined;

    // The engine's revised days: one multi-day change, confirmed and saved
    // like a pasted draft (apply_draft), in one write. New days go after the
    // last one, and the trip's end date moves with them.
    let engineEndDate: string | undefined;
    if (engineEdited && tripEdits) {
      const fixedDays = validateAndFixCoordinates(tripEdits.revisedDays, tripContext.destination);
      for (const day of fixedDays) {
        const idx = modifiedItinerary.findIndex((d) => d.day_number === day.day_number);
        if (idx !== -1) modifiedItinerary[idx] = day;
        else modifiedItinerary.push(day);
      }
      const lastDate = modifiedItinerary[modifiedItinerary.length - 1]?.date;
      if (modifiedItinerary.length > itinerary.length && lastDate) {
        engineEndDate = computeExtendedEndDate(trip.end_date, lastDate) ?? undefined;
      }
      actionTaken = {
        type: "apply_draft",
        applied: false,
        dayNumber: fixedDays[0].day_number,
        dayCount: fixedDays.length,
        revisedDays: fixedDays,
        ...(engineEndDate ? { newEndDate: engineEndDate } : {}),
      };
    }

    // Structural no-op note (cap reached, nothing mappable, …) — injected
    // into the model prompt so the reply explains kindly instead of the
    // generic "it failed" framing replacementError produces.
    let structuralNote: string | undefined;
    // apply_draft: current day numbers the draft did not cover (they stay
    // untouched and the reply must say so).
    let draftUnmappedDayNumbers: number[] = [];

    // Handle ADD_DAY (structural): append ONE new day after the last one
    // ("can you add a day to travel to Voss"). This path
    // proposes a real Day N+1 (confirm-first) and moves the trip's end date
    // together with the itinerary on apply. The edit engine handles it first.
    if (structuralIntent.type === "add_day" && !tripEdits) {
      const currentDayCount = modifiedItinerary.length;
      const requestedTotal = structuralIntent.requestedTotalDays;

      if (assistantRole !== "owner") {
        // Adding a day moves the trip's end date, which stays with the owner
        // (lib/ai/assistant-access.ts): /apply would refuse the proposal, so
        // say so now instead of generating a day nobody can apply.
        structuralNote = `The user is an editor of this trip, not its owner. Only the trip owner can add days or change the trip's dates. NO change was made. Explain that kindly and suggest asking the trip owner to add the day.`;
      } else if (currentDayCount === 0) {
        replacementError = "This trip has no itinerary days yet, so there is nothing to extend";
      } else if (
        currentDayCount >= MAX_TRIP_DAYS ||
        (requestedTotal !== undefined && requestedTotal > MAX_TRIP_DAYS)
      ) {
        // HARD CAP — mirrors the generation-side 14-day limit
        // (lib/gemini.ts validateTripDuration). No action taken.
        structuralNote = `The user asked to extend the trip${requestedTotal ? ` to ${requestedTotal} days` : ""}, but trips are capped at ${MAX_TRIP_DAYS} days${currentDayCount >= MAX_TRIP_DAYS ? ` and this trip already has ${currentDayCount}` : ""}. NO change was made. Kindly explain the ${MAX_TRIP_DAYS}-day maximum and suggest alternatives (freeing up a lighter day, or planning the extra days as a second trip).`;
      } else if (requestedTotal !== undefined && requestedTotal <= currentDayCount) {
        structuralNote = `The user asked for a ${requestedTotal}-day trip but this trip already has ${currentDayCount} days. NO change was made. Explain that, and that removing days isn't supported from chat yet.`;
      } else {
        console.log(`[AI Assistant] Attempting to add Day ${currentDayCount + 1}`);
        try {
          const lastDay = modifiedItinerary[currentDayCount - 1];
          const newDayNumber = (lastDay.day_number || currentDayCount) + 1;
          const newDate = nextDateISO([lastDay.date, trip.end_date]);
          if (!newDate) {
            throw new Error("Could not derive a date for the new day");
          }

          // Trip context mirrors /api/ai/regenerate-day: budget tier from
          // the budget column, vibes inferred from tags, travel style from
          // trip_meta (a backpacker trip must not grow a classic day).
          const budgetTier = (((trip.budget as { tier?: string } | null)?.tier ??
            "balanced") as BudgetTier);
          const tags = (trip.tags as string[] | null) ?? [];
          const vibes = tags.filter(isTripVibe);
          const tripMeta = (trip.trip_meta ?? {}) as { travel_style?: "classic" | "backpacker"; dietary?: unknown };

          // Reuses the single-day generation contract — day shape, activity
          // IDs via generateActivityId, coordinate backfill via
          // validateAndFixCoordinates all happen inside regenerateSingleDay
          // (lib/gemini.ts). The user's message steers the day's content
          // ("… a day to travel to Voss" → that's the theme).
          const newDay = await regenerateSingleDay({
            destination: lastDay.city || tripContext.destination, // multi-city: stay in the last day's city
            dayNumber: newDayNumber,
            date: newDate,
            budgetTier,
            pace: "moderate",
            vibes,
            surroundingDays: modifiedItinerary,
            instructions: message.slice(0, 500),
            travelStyle: tripMeta.travel_style === "backpacker" ? "backpacker" : "classic",
            profilePreferences: { dietaryPreferences: dietsFrom(tripMeta.dietary) },
            language: userLanguage,
            userId: user.id,
          });
          if (lastDay.city && !newDay.city) newDay.city = lastDay.city;
          // A diet trip's places to eat that Maps has as closed, or doesn't
          // have, replaced by open ones or left out (lib/places/places-to-eat.ts).
          await placesToEatCheck({
            destination: tripContext.destination,
            dietary: dietsFrom(tripMeta.dietary),
            budgetTier,
            travelStyle: tripMeta.travel_style === "backpacker" ? "backpacker" : "classic",
            language: userLanguage,
            userId: user.id,
          })
            ?.finish([newDay], modifiedItinerary)
            .catch((checkErr) => console.error("[AI Assistant] places-to-eat check error:", checkErr));

          const newEndDate = computeExtendedEndDate(trip.end_date, newDate) ?? undefined;

          modifiedItinerary.push(newDay);

          actionTaken = {
            type: "add_day",
            applied: false,
            dayNumber: newDayNumber,
            newDay,
            newEndDate,
          };
          console.log(`[AI Assistant] Prepared new Day ${newDayNumber} for confirmation`);
        } catch (err) {
          console.error("[AI Assistant] Failed to generate new day:", err);
          replacementError = `Failed to generate the new day: ${err instanceof Error ? err.message : "Unknown error"}`;
          actionTaken = undefined;
        }
      }
    }

    // Handle APPLY_DRAFT (structural): the user pasted a multi-day plan
    // ("rearrange as per my own draft", "update all days according to my
    // input"), which the single-activity tools could only mangle.
    // Maps the draft onto the CURRENT trip length and proposes ONE bulk
    // multi-day edit. Never changes trip length (that's add_day's job).
    if (structuralIntent.type === "apply_draft") {
      const lockedAcrossTrip = modifiedItinerary.flatMap((d) => lockedActivityNames(d));

      if (modifiedItinerary.length === 0) {
        replacementError = "This trip has no itinerary days yet, so there is nothing to revise";
      } else if (lockedAcrossTrip.length > 0) {
        // apply_draft rewrites whole days in bulk, which would erase anchors.
        // Deliberately does NOT point at the wizard's "Paste a plan" import:
        // that panel only exists on step 1, before the trip is saved, so on a
        // saved trip it would be a door that isn't there. Offer what actually
        // works today — per-day edits on the unpinned days.
        replacementError = `This trip is built around fixed plans (${lockedAcrossTrip.slice(0, 3).join(", ")}), so I won't rewrite it wholesale from a pasted draft. Tell me what to change on a specific day and I'll do that instead.`;
        console.log(`[AI Assistant] Refused apply_draft on anchored trip (${lockedAcrossTrip.length} locked)`);
      } else {
        console.log(`[AI Assistant] Attempting to map pasted draft onto ${modifiedItinerary.length} days`);
        try {
          // assistant-optimize → gemini-2.5-flash: reasoning over the whole
          // trip structure.
          const draftModel = genAI.getGenerativeModel({
            model: getModelForPurpose("assistant-optimize"),
            generationConfig: {
              temperature: 0.4,
              // Up to 14 revised days.
              maxOutputTokens: 16384,
              responseMimeType: "application/json",
            },
          });

          const currentDaysCompact = modifiedItinerary.map((d) => ({
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

          const draftPrompt = `You are revising a ${modifiedItinerary.length}-day trip itinerary for ${tripContext.destination} according to a draft plan the user pasted.${chatLanguageInstruction(userLanguage)}

CURRENT ITINERARY (day_number and date are FIXED):
${JSON.stringify(currentDaysCompact, null, 1)}

USER'S MESSAGE (their draft/instructions):
${message}

Map the user's draft onto the CURRENT days. Rules:
1. Only use existing day_numbers (1-${modifiedItinerary.length}). NEVER invent new days or change dates.
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
          const normalized = normalizeDraftDays(parsedDraft.revisedDays, itinerary);

          if (normalized.days.length === 0) {
            structuralNote = "The user's message looked like a pasted multi-day draft, but none of its days could be mapped onto the current trip. NO change was made. Ask them to label days as 'Day 1', 'Day 2', … matching the trip's current days.";
          } else {
            // Same coordinate backfill the generators use (lib/gemini.ts).
            const fixedDays = validateAndFixCoordinates(
              normalized.days,
              tripContext.destination
            );
            for (const day of fixedDays) {
              const idx = modifiedItinerary.findIndex(
                (d) => d.day_number === day.day_number
              );
              if (idx !== -1) modifiedItinerary[idx] = day;
            }
            draftUnmappedDayNumbers = normalized.unmappedDayNumbers;

            actionTaken = {
              type: "apply_draft",
              applied: false,
              dayNumber: normalized.changedDayNumbers[0],
              dayCount: normalized.changedDayNumbers.length,
              revisedDays: fixedDays,
            };
            console.log(`[AI Assistant] Prepared draft revision of days ${normalized.changedDayNumbers.join(", ")}`);
          }
        } catch (err) {
          console.error("[AI Assistant] Failed to map draft:", err);
          replacementError = `Failed to map your draft onto the trip: ${err instanceof Error ? err.message : "Unknown error"}`;
          actionTaken = undefined;
        }
      }
    }

    // Classify and select model
    const contextLength = JSON.stringify(tripContext).length;
    const classification = classifyTask(message, contextLength);
    const modelConfig = selectModel(classification);

    // Build conversation context
    const recentMessages = conversation.messages.slice(-4);
    const conversationHistory = recentMessages
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n");

    // Build prompt with action context. What the user is told comes from what
    // the server prepared, never from the model's own claim.
    if (replacementError) {
      // A change that failed leaves no action behind.
      actionTaken = undefined;
    }
    // A prepared change waits for the user's confirm: nothing is saved here.
    if (actionTaken) actionTaken = { ...actionTaken, pending: true };

    let actionContext = "";
    if (replacementError) {
      // Checked FIRST. It used to be the last branch of an else-if chain whose
      // earlier arms still matched on a failure, so it never ran.
      actionContext = `
IMPORTANT - THE CHANGE DID NOT HAPPEN. The itinerary is unchanged.
Reason: ${replacementError}
Tell the user plainly that it did not work and why, in one or two short
sentences, then offer what they can try instead. Never suggest that any part
of it succeeded.`;
    } else if (actionTaken) {
      const change = describeChange(actionTaken);
      const extra =
        actionTaken.type === "apply_draft" && draftUnmappedDayNumbers.length > 0
          ? ` Days ${draftUnmappedDayNumbers.join(", ")} could not be read from the draft and are unchanged - say so explicitly.`
          : "";
      actionContext = pendingActionContext(change, await applyButtonLabel(userLanguage)) + extra;
    } else if (structuralNote) {
      actionContext = `
NOTE: ${structuralNote}`;
    }


    const systemPrompt = buildSystemPrompt(tripContext);
    const languageInstruction = chatLanguageInstruction(userLanguage) + replyLanguageRule(userLanguage);
    const fullPrompt = `${systemPrompt}${languageInstruction}
${actionContext}
${conversationHistory ? `\nRecent conversation:\n${conversationHistory}\n` : ""}
User: ${message}

Respond with valid JSON only.`;

    // The engine's own reply, when it prepared the change, or answered and
    // nothing else was prepared. It already read the plan and the
    // conversation, so the chat call below is skipped.
    const engineReply = tripEdits && (engineEdited || !actionTaken) ? tripEdits.reply : null;

    let parsedResponse: StructuredAssistantResponse;
    let responseText = "";
    if (engineReply !== null) {
      parsedResponse = { summary: engineReply, cards: [] };
    } else {
      // Call AI
      const model = genAI.getGenerativeModel({ model: modelConfig.id });
      const result = await model.generateContent(fullPrompt);
      responseText = result.response.text();

      // Wire prompt-cache hit-rate monitoring (see lib/ai/cache-metrics.ts). This is
      // the main chat-message call — buildSystemPrompt produces a long
      // stable preamble so this site should dominate the rolling window
      // with healthy cache hits.
      logCacheMetrics("ai.assistant.chat", result.response.usageMetadata);

      // Parse JSON response
      try {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsedResponse = JSON.parse(jsonMatch[0]);
        } else {
          // Fallback to plain text response
          parsedResponse = {
            summary: responseText.slice(0, 200),
            cards: [],
          };
        }
      } catch {
        parsedResponse = {
          summary: responseText.slice(0, 200),
          cards: [],
        };
      }
    }

    // Cards that show a change as done ("Activity Replaced", "Added") never
    // reach the reply: nothing is saved on this turn, and the confirm card
    // already shows the before and after. The model writes such cards too, so
    // whatever it produces is filtered.
    const CHANGE_CARDS = new Set(["activity_replacement", "activity_added", "activity_suggestion", "confirmation"]);
    if (Array.isArray(parsedResponse.cards)) {
      parsedResponse.cards = parsedResponse.cards.filter(
        (c) => !CHANGE_CARDS.has((c as { type?: string })?.type ?? "")
      );
    }

    // The words as well as the cards. Nothing was saved on this turn, so the
    // reply may not say otherwise, whatever the prompt got out of the model
    // (the prompt rule alone doesn't hold). lib/ai/assistant/honesty.ts.
    // "Noted" and "recorded" claim a memory this assistant does not have:
    // only the last few messages come back with the next prompt.
    let honestyGuarded = false;
    let pendingNote: string | undefined;
    // "Here's the proposal" is true of a prepared change, so it counts only
    // when there is none.
    const claimedChange =
      claimsItineraryChange(parsedResponse.summary) ||
      (!actionTaken && announcesProposal(parsedResponse.summary));
    if (claimedChange || claimsToRemember(parsedResponse.summary)) {
      console.warn(
        `[AI Assistant] honesty guard replaced a ${claimedChange ? "change" : "memory"} claim (${actionTaken ? "change pending" : "nothing prepared"}): "${String(parsedResponse.summary).slice(0, 120)}"`
      );
      // The engine's words are the answer and say what each day gets: they
      // stay, and the truth about the button follows them, just above it.
      // Put first, it read "Not saved yet: … Absolutely! I've extended…".
      // Other words become "I've prepared this change", true before and after
      // the button.
      if (actionTaken) {
        parsedResponse.summary = engineReply !== null && claimedChange ? engineReply : preparedChangeReply(userLanguage);
        pendingNote = pendingChangeNote(userLanguage, await applyButtonLabel(userLanguage));
      } else {
        parsedResponse.summary = claimedChange ? nothingChangedReply(userLanguage) : nothingKeptReply(userLanguage);
      }
      honestyGuarded = true;
    }

    // The action metadata is the SERVER's, unconditionally — including when
    // the server did nothing, in which case it is `undefined` and the model's
    // own claim is discarded.
    //
    // This assignment used to sit behind `if (<the change's card>) ... else if
    // (actionTaken)`, so whenever neither existed the model's invented action
    // survived into the response and the saved history. That is how 12
    // "remove_activity ... applied: true" records exist for an intent that has
    // no handler in this file at all: the user asked, nothing ran, and the
    // model filled in the blank from the prompt's own example.
    //
    // Structural actions (add_day / apply_draft) carry no chat card — their
    // confirm-first UI is the client's PendingChange card — but their metadata
    // must still ride the message: it drives the badge and the history.
    parsedResponse.action = actionTaken;

    // Estimate tokens and cost. The engine reports its own cost; the chat
    // call is estimated, and only counted when it ran.
    const inputTokens = engineReply !== null ? 0 : Math.ceil(fullPrompt.length / 4);
    const outputTokens = engineReply !== null ? 0 : Math.ceil(responseText.length / 4);
    const costCents =
      (engineReply !== null ? 0 : estimateCost(modelConfig, inputTokens, outputTokens)) +
      (tripEdits ? tripEdits.meta.costUsd * 100 : 0);

    // Record usage in existing system
    await recordUsage({
      userId: user.id,
      tripId,
      modelId: engineReply !== null && tripEdits ? tripEdits.meta.model : modelConfig.id,
      action: actionTaken?.type || "answer_question",
      inputTokens,
      outputTokens,
      costCents,
    });

    // Increment usage counter in new tier-based system
    await incrementUsage(user.id, "aiAssistantMessages", 1);

    // Save messages
    const userMessage: AssistantMessage = {
      role: "user",
      content: message,
      timestamp: new Date().toISOString(),
    };

    const assistantMessage: AssistantMessage = {
      role: "assistant",
      content: parsedResponse.summary,
      cards: parsedResponse.cards,
      action: parsedResponse.action ? {
        type: parsedResponse.action.type,
        applied: parsedResponse.action.applied,
        // Persisted so the history can be read back as evidence. Without it,
        // a prepared-but-never-confirmed change is indistinguishable from a
        // saved one — which is precisely why the old records could not be
        // trusted when diagnosing this.
        pending: parsedResponse.action.pending,
        activityId: parsedResponse.action.activityId,
        dayNumber: parsedResponse.action.dayNumber,
        dayCount: parsedResponse.action.dayCount,
      } : undefined,
      ...(honestyGuarded ? { guarded: true } : {}),
      ...(pendingNote ? { pendingNote } : {}),
      timestamp: new Date().toISOString(),
    };

    logWriteError("assistant: conversation", await supabase
      .from("ai_conversations")
      .update({
        messages: [...conversation.messages, userMessage, assistantMessage],
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversation.id));

    // Update usage info for response
    const updatedUsage = {
      ...usageCheck,
      used: usageCheck.used + 1,
      remaining: Math.max(0, usageCheck.remaining - 1),
    };

    // The change waiting for the user's confirm.
    const pendingChange = pendingChangeFor(actionTaken, {
      failed: Boolean(replacementError),
      previousEndDate: trip.end_date as string | undefined,
      unmappedDayNumbers: draftUnmappedDayNumbers,
      engineSummary: engineEdited ? (tripEdits?.summary ?? "") : null,
    });

    const responsePayload = {
      message: assistantMessage,
      conversationId: conversation.id,
      model: modelConfig.name,
      complexity: classification.complexity,
      pendingChange,
      usage: {
        inputTokens,
        outputTokens,
        costCents,
        tier: updatedUsage.tier,
        remaining: updatedUsage.remaining,
        limit: updatedUsage.limit,
        resetAt: updatedUsage.resetAt,
      },
      // Debug info
      debug: {
        replacementError,
      },
    };

    console.log(`[AI Assistant] Response: pendingChange=${pendingChange?.type ?? "none"}`);

    return apiSuccess(responsePayload);
  } catch (error) {
    console.error("[AI Assistant] POST error:", error);

    // Capture to Sentry — Assistant failures previously only hit console
    // + the centralized response wrapper without an exception event.
    // Task #223. Duration is not tracked at this scope because the POST
    // handler doesn't capture startTime; we pass 0 so the field is
    // still set and dashboards don't break on missing data.
    void recordAiOutcome({
      endpoint: "assistant",
      outcome: "failure",
      durationMs: 0,
      error,
    });

    return errors.internal("Failed to process request", "AI Assistant");
  }
}

// GET endpoint to fetch conversation history
export async function GET(request: NextRequest) {
  try {
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    const { searchParams } = new URL(request.url);
    const tripId = searchParams.get("tripId");
    const conversationId = searchParams.get("conversationId");

    // The concierge's rows share the table; this chat never shows them.
    if (conversationId) {
      const { data: conversation, error } = await supabase
        .from("ai_conversations")
        .select("*")
        .eq("id", conversationId)
        .eq("user_id", user.id)
        .single();
      if (error && !isNoRow(error)) throw error;

      return apiSuccess({ conversation: conversation && !isConciergeRow(conversation.context) ? conversation : null });
    }

    if (tripId) {
      const { data: rows, error } = await supabase
        .from("ai_conversations")
        .select("id, created_at, updated_at, messages, context")
        .eq("trip_id", tripId)
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false });
      if (error) throw error;

      const conversations = (rows ?? [])
        .filter((row) => !isConciergeRow(row.context))
        .map(({ id, created_at, updated_at, messages }) => ({ id, created_at, updated_at, messages }));
      return apiSuccess({ conversations });
    }

    return errors.badRequest("Missing tripId or conversationId");
  } catch (error) {
    console.error("[AI Assistant] GET error:", error);
    return errors.internal("Failed to fetch conversations", "AI Assistant");
  }
}
