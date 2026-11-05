import { logCacheMetrics } from "@/lib/ai/cache-metrics";
import { noProposalNote, replyLanguage } from "@/lib/ai/assistant/honesty";
import {
  PROPOSAL_MARKER,
  emittableLength,
  proposalOwed,
  proposalRequest,
  requestedProposalJson,
  resolveConciergeProposal,
  splitAnswerAndProposal,
  type ConciergeProposal,
} from "@/lib/ai/concierge-proposal";
import type { ConciergeTurn, TodaySlice } from "@/lib/ai/concierge-trip";
import { CONCIERGE_SURFACE } from "@/lib/ai/conversations";
import { geminiCostUsd } from "@/lib/ai/gemini-cost";
import { LANGUAGE_NAMES, type SupportedLanguage } from "@/lib/ai/language";
import { recordAiOutcome, type AiModel } from "@/lib/ai/observability";
import { logApiCall } from "@/lib/api-gateway";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ItineraryDay } from "@/types";
import type { Content, GoogleGenerativeAI } from "@/lib/ai/genai-compat";
import { isModelOutOfCredit, MODEL_OUTAGE_CODE } from "@/lib/ai/model-outage";

type ConciergeModel = ReturnType<GoogleGenerativeAI["getGenerativeModel"]>;

const SYSTEM_PROMPT = `You are MonkeyTravel's in-trip Concierge — a real-time travel companion for a SPECIFIC saved trip the user has open right now.

RULES:
1. Answer the user's question concisely and practically. Maximum 4 short paragraphs unless they ask for more.
2. The user's saved itinerary is provided as JSON below — reference SPECIFIC activities/days when relevant. Don't pretend you don't know the plan.
3. When the user asks you to CHANGE the plan (swap, drop, add, shorten, move something), answer AND attach ONE edit proposal using the EDIT PROPOSAL protocol below. The user confirms before anything is applied — NEVER claim a change has already been made.
4. When TODAY'S CONTEXT is provided, prioritize answers grounded in today's activities, their completion status, and the day number. The user is likely physically on the trip.
5. Never invent venues, opening hours, prices, or coordinates. If asked something the itinerary doesn't cover, say "I don't have that in your plan — want me to suggest options?" and offer 2-3 generic ideas tied to the destination.
6. Match the user's language: respond in the same language they wrote in.
7. No emojis. No markdown headers. Plain prose with at most a short bullet list when listing 3+ items.

EDIT PROPOSAL protocol:
- Only when the user's message asks for a concrete change. Questions get answers, not proposals.
- Write your conversational answer first (explain what you suggest and why, in their language).
- Then output, as the VERY LAST line: ${PROPOSAL_MARKER} followed on the same line by minified JSON:
  {"type":"replace"|"add"|"remove"|"adjust_duration"|"shift_days","dayNumber":<n>,"targetActivityId":"<the activity's id from the itinerary JSON>","newActivity":{"name":"...","type":"restaurant|attraction|activity|nature","description":"1-2 sentences","location":"neighborhood","address":"street address if known","start_time":"HH:MM","duration_minutes":<n>,"estimated_cost":{"amount":<n>,"currency":"<trip currency>","tier":"budget"|"moderate"|"premium"}},"newDuration":<minutes>,"shiftByDays":<1-7>,"reason":"one short sentence"}
- Field rules: every type has dayNumber. replace → targetActivityId + newActivity. add → newActivity. remove → targetActivityId. adjust_duration → targetActivityId + newDuration. shift_days → dayNumber (the FIRST day to push later) + shiftByDays.
- shift_days is for schedule disruptions ("our flight got cancelled, push everything from tomorrow back a day"): EVERY day from dayNumber to the end of the trip moves later by shiftByDays and the trip's end date extends. Never propose it when any affected day contains a "locked": true activity.
- Use the EXACT activity id from the itinerary JSON. Only propose real venues you are confident exist. Never target an activity marked "locked": true — those are the traveller's fixed plans.
- At most ONE proposal per reply. Nothing may follow the JSON.`;

/**
 * The traveller's language, named when it shows: in the question, or for a reply of
 * a word or two ("ok", "si aggiungi") in their earlier questions, else the trip's.
 * Left to the model, Italian questions were answered in English, and the English
 * answers replayed in the prompt kept the next ones so.
 */
function languageRule(question: string, memory: ConciergeTurn[], tripLanguage: SupportedLanguage | null): string {
  const writesIn =
    replyLanguage(question) ??
    (question.split(/\s+/).length <= 3
      ? (replyLanguage(memory.map((t) => t.question).join(" ")) ?? tripLanguage ?? undefined)
      : undefined);
  return writesIn ? `\n\nAnswer in ${LANGUAGE_NAMES[writesIn]}.` : "";
}

/** The rules, the replayed turns as real chat turns, then the trip and the question. */
export function conciergePrompt({
  question,
  memory,
  tripContext,
  tripLanguage,
}: {
  question: string;
  memory: ConciergeTurn[];
  tripContext: string;
  tripLanguage: SupportedLanguage | null;
}): Content[] {
  return [
    { role: "user", parts: [{ text: SYSTEM_PROMPT }] },
    {
      role: "model",
      parts: [
        {
          text: "Understood. I'll answer concisely, ground in the itinerary, and only ever PROPOSE edits for the user to confirm.",
        },
      ],
    },
    ...memory.flatMap((t): Content[] => [
      { role: "user", parts: [{ text: t.question }] },
      { role: "model", parts: [{ text: t.answer }] },
    ]),
    {
      role: "user",
      parts: [
        {
          text: `TRIP CONTEXT (JSON):\n${tripContext}\n\nUSER QUESTION:\n${question}${languageRule(question, memory, tripLanguage)}`,
        },
      ],
    },
  ];
}

/**
 * One row per turn (question + answer) in `ai_conversations`, marked
 * `context.surface` so the trip assistant, which keeps its threads in the same
 * table, never reads it (lib/ai/conversations.ts). This is what the concierge
 * replays as memory, and how its questions can be audited after a trip is gone.
 *
 * Fire-and-forget. Never blocks the answer.
 */
async function persistConciergeTurn(input: {
  userId: string;
  tripId: string;
  question: string;
  answer: string;
  model: string;
  isLiveTrip: boolean;
  dayNumber: number | null;
  proposalType?: string | null;
}): Promise<void> {
  try {
    const supabase = createAdminClient();
    const now = new Date().toISOString();
    const { error } = await supabase.from("ai_conversations").insert({
      user_id: input.userId,
      trip_id: input.tripId,
      messages: [
        { role: "user", content: input.question, timestamp: now },
        { role: "assistant", content: input.answer, model: input.model, timestamp: now },
      ],
      context: {
        surface: CONCIERGE_SURFACE,
        is_live_trip: input.isLiveTrip,
        day_number: input.dayNumber,
        // Which edit type (if any) this turn proposed: feeds the "% of concierge
        // proposals applied" metric.
        ...(input.proposalType ? { proposal_type: input.proposalType } : {}),
      },
    });
    if (error) {
      console.error("[concierge] persist turn failed", error);
    }
  } catch (err) {
    // Never let a logging path break the user-facing answer.
    console.error("[concierge] persist turn threw", err);
  }
}

/**
 * Gemini's answer as server-sent events, which drop the first token from ~3s to
 * ~200ms: `chunk`s of the answer, at most one `proposal`, then `done` or `error`.
 * Stored and reported whichever way it ends.
 */
export function conciergeAnswerStream({
  model,
  modelName,
  contents,
  question,
  itinerary,
  tripCurrency,
  tripLanguage,
  todaySlice,
  userId,
  tripId,
  startTime,
}: {
  model: ConciergeModel;
  modelName: AiModel;
  contents: Content[];
  question: string;
  itinerary: ItineraryDay[];
  tripCurrency: string;
  tripLanguage: SupportedLanguage | null;
  todaySlice: TodaySlice | null;
  userId: string;
  tripId: string;
  startTime: number;
}): ReadableStream<Uint8Array> {
  // An answer owed a proposal it came without (proposalOwed) gets one more
  // call for the proposal line alone. When a change it handed over still
  // can't be attached, a note says so: the words are already on screen.
  const settleProposal = async (
    answer: string
  ): Promise<{ proposal: ConciergeProposal | null; note: string | null; costUsd: number }> => {
    const owed = proposalOwed(question, answer);
    if (!owed) return { proposal: null, note: null, costUsd: 0 };
    let proposal: ConciergeProposal | null = null;
    let none = false;
    let costUsd = 0;
    try {
      const result = await model.generateContent({
        contents: [
          ...contents,
          { role: "model" as const, parts: [{ text: answer }] },
          { role: "user" as const, parts: [{ text: proposalRequest(owed) }] },
        ],
      });
      logCacheMetrics("ai.concierge.proposal", result.response.usageMetadata, modelName);
      costUsd = geminiCostUsd(modelName, result.response.usageMetadata);
      const json = requestedProposalJson(result.response.text());
      none = json === "none";
      proposal = json && json !== "none" ? resolveConciergeProposal(json, itinerary, tripCurrency) : null;
    } catch (err) {
      console.warn("[concierge] proposal follow-up failed", err);
    }
    const note =
      !proposal && !none && owed === "promised" ? noProposalNote(replyLanguage(answer) ?? tripLanguage ?? undefined) : null;
    return { proposal, note, costUsd };
  };

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const emit = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      // Everything after the proposal marker is machine-readable JSON that must
      // not reach the client as answer text. `emittableLength` says how much of
      // the accumulated buffer is safe to flush (it also withholds a trailing
      // partial marker split across chunk boundaries).
      let accumulated = "";
      let emitted = 0;
      // What the answer cost, from its tokens (lib/ai/gemini-cost.ts).
      let costUsd = 0;
      try {
        const result = await model.generateContentStream({ contents });
        for await (const chunk of result.stream) {
          const text = chunk.text();
          if (text) {
            accumulated += text;
            const safe = emittableLength(accumulated);
            if (safe > emitted) {
              emit({ type: "chunk", text: accumulated.slice(emitted, safe) });
              emitted = safe;
            }
          }
        }

        // Stream complete: split the answer from the proposal, resolve the
        // proposal against the STORED itinerary (ids only, so the model can never
        // smuggle a fabricated oldActivity to /apply), and flush any answer text
        // the holdback was still sitting on.
        const { answer: finalAnswer, proposalJson } = splitAnswerAndProposal(accumulated);
        if (finalAnswer.length > emitted) {
          emit({ type: "chunk", text: finalAnswer.slice(emitted) });
        }
        let proposal: ConciergeProposal | null = null;
        if (proposalJson) {
          proposal = resolveConciergeProposal(proposalJson, itinerary, tripCurrency);
          if (proposal) {
            emit({ type: "proposal", proposal });
          }
        }

        // The SDK exposes the aggregated response (with usageMetadata) once the
        // stream is consumed. Best-effort: "done" never waits on it failing.
        try {
          const finalResponse = await result.response;
          logCacheMetrics("ai.concierge.stream", finalResponse.usageMetadata, modelName);
          costUsd = geminiCostUsd(modelName, finalResponse.usageMetadata);
        } catch {
          /* usageMetadata is best-effort — don't fail the request */
        }

        let answerText = finalAnswer;
        if (!proposal) {
          const settled = await settleProposal(finalAnswer);
          costUsd += settled.costUsd;
          proposal = settled.proposal;
          if (proposal) {
            emit({ type: "proposal", proposal });
          } else if (settled.note) {
            emit({ type: "chunk", text: `\n\n${settled.note}` });
            answerText = `${finalAnswer}\n\n${settled.note}`;
          }
        }

        emit({
          type: "done",
          isLiveTrip: todaySlice !== null,
          dayNumber: todaySlice?.dayNumber ?? null,
        });

        // Done in start() so it sees the final duration.
        void logApiCall({
          apiName: "gemini",
          endpoint: "/api/ai/concierge",
          status: 200,
          responseTimeMs: Date.now() - startTime,
          cacheHit: false,
          costUsd,
          exactCost: true,
          userId,
          metadata: {
            user_id: userId,
            trip_id: tripId,
            is_live_trip: todaySlice !== null,
          },
        }).catch(() => {});

        void recordAiOutcome({
          endpoint: "assistant",
          outcome: "success",
          model: modelName,
          durationMs: Date.now() - startTime,
          userId,
          metadata: {
            subroute: "concierge",
            is_live_trip: todaySlice !== null,
          },
        });

        // Only the conversational answer: the proposal JSON is a machine payload,
        // not something the memory should feed back into the prompt as prose.
        void persistConciergeTurn({
          userId,
          tripId,
          question,
          answer: answerText,
          model: modelName,
          isLiveTrip: todaySlice !== null,
          dayNumber: todaySlice?.dayNumber ?? null,
          proposalType: proposal?.type ?? null,
        });
      } catch (err) {
        console.error("[concierge] streaming Gemini call failed", err);
        emit(isModelOutOfCredit(err) ? { type: "error", code: MODEL_OUTAGE_CODE } : { type: "error" });

        void recordAiOutcome({
          endpoint: "assistant",
          outcome: "failure",
          model: modelName,
          durationMs: Date.now() - startTime,
          error: err,
          userId,
          metadata: { subroute: "concierge" },
        });

        void logApiCall({
          apiName: "gemini",
          endpoint: "/api/ai/concierge",
          status: 500,
          responseTimeMs: Date.now() - startTime,
          cacheHit: false,
          costUsd: 0,
          exactCost: true,
          error: err instanceof Error ? err.message : "unknown",
          userId,
        }).catch(() => {});
      } finally {
        controller.close();
      }
    },
  });
}
