import { geminiCostUsd, type GeminiUsage } from "@/lib/ai/gemini-cost";
import { recordUsage } from "@/lib/ai/usage";
import { incrementUsage } from "@/lib/usage-limits";

/**
 * What a trip-assistant turn spent, recorded and counted toward the user's
 * limit. The edit engine reports its own cost. The chat call is priced from the
 * tokens it used, and only counted when it ran: `chat` is null when the engine's
 * own words were the reply.
 */
export async function recordTurnUsage(input: {
  userId: string;
  tripId: string;
  action: string | undefined;
  engine: { model: string; costUsd: number } | null;
  chat: { model: string; usage: GeminiUsage | undefined } | null;
}): Promise<{ inputTokens: number; outputTokens: number; costCents: number }> {
  const { userId, tripId, action, engine, chat } = input;
  const inputTokens = chat?.usage?.promptTokenCount ?? 0;
  const outputTokens = (chat?.usage?.candidatesTokenCount ?? 0) + (chat?.usage?.thoughtsTokenCount ?? 0);
  const costCents = ((chat ? geminiCostUsd(chat.model, chat.usage) : 0) + (engine?.costUsd ?? 0)) * 100;

  await recordUsage({
    userId,
    tripId,
    modelId: chat?.model ?? engine?.model ?? "",
    action: action || "answer_question",
    inputTokens,
    outputTokens,
    costCents,
  });
  await incrementUsage(userId, "aiAssistantMessages", 1);

  return { inputTokens, outputTokens, costCents };
}
