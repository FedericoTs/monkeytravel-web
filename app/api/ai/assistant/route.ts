import { NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { GoogleGenerativeAI } from "@/lib/ai/genai-compat";
import { detectStructuralIntent } from "@/lib/ai/assistant/structural";
import { classifyTask, selectModel } from "@/lib/ai/config";
import { recordTurnUsage } from "@/lib/ai/assistant/turn-usage";
import { isModelOutOfCredit } from "@/lib/ai/model-outage";
import { recordAiOutcome } from "@/lib/ai/observability";
import { getTripDestination } from "@/lib/trips/destination";
import {
  type ItineraryDay,
  type StructuredAssistantResponse,
} from "@/types";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { applyButtonLabel } from "@/lib/ai/assistant/apply-button";
import { honestReply } from "@/lib/ai/assistant/honesty";
import {
  conversationTurns,
  proposedChange,
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
import { appendTurn, assistantMessage, listThreads, openThread, readThread, userMessage } from "@/lib/ai/assistant/thread";

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

    // What this turn prepares for the user's confirm: a pasted draft's days
    // (draft-change.ts), one new day when the engine could not add it
    // (add-day.ts), else the engine's revised days (trip-edits.ts). The outcome
    // is the change, why it failed, or a note for the reply when nothing changes.
    const prepared: {
      action?: StructuredAssistantResponse["action"];
      error?: string;
      note?: string;
      unmapped?: number[];
    } =
      structuralIntent.type === "apply_draft"
        ? await prepareDraftChange({ days: itinerary, destination: tripContext.destination, message, language: userLanguage, genAI })
        : structuralIntent.type === "add_day" && !tripEdits
          ? await prepareAddDay({
              days: itinerary,
              requestedTotal: structuralIntent.requestedTotalDays,
              role: assistantRole,
              trip,
              destination: tripContext.destination,
              message,
              language: userLanguage,
              userId: user.id,
            })
          : {
              action: tripEdits
                ? proposedChange(tripEdits, { days: itinerary, destination: tripContext.destination, endDate: trip.end_date })
                : undefined,
            };
    // The days a draft did not cover stay as they are, and the reply must say so.
    const unmappedDayNumbers = prepared.unmapped ?? [];

    // Classify and select model
    const contextLength = JSON.stringify(tripContext).length;
    const classification = classifyTask(message, contextLength);
    const modelConfig = selectModel(classification);

    // What the user is told comes from what the server prepared, never from the
    // model's own claim. A prepared change waits for the user's confirm: nothing
    // is saved here.
    const actionTaken = prepared.action && { ...prepared.action, pending: true };

    const fullPrompt = chatPrompt({
      tripContext,
      language: userLanguage,
      turn: turnContext({
        failure: prepared.error,
        action: actionTaken,
        buttonLabel: actionTaken ? await applyButtonLabel(userLanguage) : "",
        unmappedDayNumbers,
        note: prepared.note,
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
    const honesty = await honestReply(parsedResponse, {
      action: actionTaken,
      engineReply,
      language: userLanguage,
    });

    const spent = await recordTurnUsage({
      userId: user.id,
      tripId,
      action: actionTaken?.type,
      engine: tripEdits?.meta ?? null,
      chatModel: modelConfig,
      chat: engineReply === null ? { prompt: fullPrompt, text: responseText } : null,
    });

    const reply = assistantMessage(parsedResponse, honesty);
    await appendTurn(supabase, conversation, [userMessage(message), reply]);

    // The change waiting for the user's confirm.
    const pendingChange = pendingChangeFor(actionTaken, {
      previousEndDate: trip.end_date as string | undefined,
      unmappedDayNumbers,
      engineSummary: engineEdited ? (tripEdits?.summary ?? "") : null,
    });

    const responsePayload = {
      message: reply,
      conversationId: conversation.id,
      model: modelConfig.name,
      complexity: classification.complexity,
      pendingChange,
      usage: {
        ...spent,
        tier: usageCheck.tier,
        remaining: Math.max(0, usageCheck.remaining - 1),
        limit: usageCheck.limit,
        resetAt: usageCheck.resetAt,
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

    if (isModelOutOfCredit(error)) return errors.modelOutage();
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

    if (conversationId) {
      return apiSuccess({ conversation: await readThread(supabase, conversationId, user.id) });
    }

    if (tripId) {
      return apiSuccess({ conversations: await listThreads(supabase, tripId, user.id) });
    }

    return errors.badRequest("Missing tripId or conversationId");
  } catch (error) {
    console.error("[AI Assistant] GET error:", error);
    return errors.internal("Failed to fetch conversations", "AI Assistant");
  }
}
