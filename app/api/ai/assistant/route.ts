import { NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { GoogleGenerativeAI } from "@/lib/ai/genai-compat";
import { validateAndFixCoordinates } from "@/lib/trip/coordinate-fallback";
import { detectStructuralIntent, computeExtendedEndDate } from "@/lib/ai/assistant/structural";
import {
  classifyTask,
  selectModel,
  estimateCost,
} from "@/lib/ai/config";
import { recordUsage } from "@/lib/ai/usage";
import { incrementUsage } from "@/lib/usage-limits";
import { recordAiOutcome } from "@/lib/ai/observability";
import { getTripDestination } from "@/lib/trips/destination";
import {
  type ItineraryDay,
  type StructuredAssistantResponse,
} from "@/types";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { isConciergeRow } from "@/lib/ai/conversations";
import { applyButtonLabel } from "@/lib/ai/assistant/apply-button";
import { honestReply } from "@/lib/ai/assistant/honesty";
import {
  conversationTurns,
  proposeTripEdits,
  readDisplayCurrency,
  type TripEditProposal,
} from "@/lib/ai/assistant/trip-edits";
import { readAssistantTurn } from "@/lib/ai/assistant/turn";
import { pendingChangeFor } from "@/lib/ai/assistant/pending-change";
import { prepareAddDay } from "@/lib/ai/assistant/add-day";
import { prepareDraftChange } from "@/lib/ai/assistant/draft-change";
import { chatPrompt, turnContext, type TripContext } from "@/lib/ai/assistant/chat-prompt";
import { askChatModel } from "@/lib/ai/assistant/chat-model";
import { appendTurn, openThread, readThread, type AssistantMessage } from "@/lib/ai/assistant/thread";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || "");

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
    // this string being correct (it's passed into the AI's tripContext below).
    const destinationName = getTripDestination(trip);

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
    const conversation = await openThread(supabase, { conversationId, userId: user.id, tripId });

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
      const added = await prepareAddDay({
        days: modifiedItinerary,
        requestedTotal: structuralIntent.requestedTotalDays,
        role: assistantRole,
        trip,
        destination: tripContext.destination,
        message,
        language: userLanguage,
        userId: user.id,
      });
      actionTaken = added.action;
      replacementError = added.error;
      structuralNote = added.note;
    }

    // Handle APPLY_DRAFT (structural): the user pasted a multi-day plan
    // ("rearrange as per my own draft", "update all days according to my
    // input"), which the single-activity tools could only mangle.
    // Maps the draft onto the CURRENT trip length and proposes ONE bulk
    // multi-day edit. Never changes trip length (that's add_day's job).
    if (structuralIntent.type === "apply_draft") {
      const draft = await prepareDraftChange({ days: itinerary, destination: tripContext.destination, message, language: userLanguage, genAI });
      actionTaken = draft.action;
      replacementError = draft.error;
      structuralNote = draft.note;
      draftUnmappedDayNumbers = draft.unmapped;
    }

    // Classify and select model
    const contextLength = JSON.stringify(tripContext).length;
    const classification = classifyTask(message, contextLength);
    const modelConfig = selectModel(classification);

    // Build prompt with action context. What the user is told comes from what
    // the server prepared, never from the model's own claim.
    if (replacementError) {
      // A change that failed leaves no action behind.
      actionTaken = undefined;
    }
    // A prepared change waits for the user's confirm: nothing is saved here.
    if (actionTaken) actionTaken = { ...actionTaken, pending: true };

    const fullPrompt = chatPrompt({
      tripContext,
      language: userLanguage,
      turn: turnContext({
        failure: replacementError,
        action: actionTaken,
        buttonLabel: actionTaken ? await applyButtonLabel(userLanguage) : "",
        unmappedDayNumbers: draftUnmappedDayNumbers,
        note: structuralNote,
      }),
      thread: conversation.messages,
      message,
    });

    // The engine's own reply, when it prepared the change, or answered and
    // nothing else was prepared. It already read the plan and the
    // conversation, so the chat call below is skipped.
    const engineReply = tripEdits && (engineEdited || !actionTaken) ? tripEdits.reply : null;

    let parsedResponse: StructuredAssistantResponse;
    let responseText = "";
    if (engineReply !== null) {
      parsedResponse = { summary: engineReply, cards: [] };
    } else {
      ({ reply: parsedResponse, text: responseText } = await askChatModel(genAI, modelConfig.id, fullPrompt));
    }

    // Nothing was saved on this turn, and the reply may not say otherwise:
    // lib/ai/assistant/honesty.ts honestReply.
    const { guarded: honestyGuarded, pendingNote } = await honestReply(parsedResponse, {
      action: actionTaken,
      engineReply,
      language: userLanguage,
    });

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

    await appendTurn(supabase, conversation, [userMessage, assistantMessage]);

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

    // Capture to Sentry, as an exception event, with how long the turn ran.
    void recordAiOutcome({
      endpoint: "assistant",
      outcome: "failure",
      durationMs: Date.now() - requestStartTime,
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
      return apiSuccess({ conversation: await readThread(supabase, conversationId, user.id) });
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
