import { estimateCost, type ModelConfig } from "@/lib/ai/config";
import { recordUsage } from "@/lib/ai/usage";
import { incrementUsage } from "@/lib/usage-limits";

/**
 * What a trip-assistant turn spent, recorded and counted toward the user's
 * limit. The edit engine reports its own cost. The chat call is estimated from
 * its text, and only counted when it ran: `chat` is null when the engine's own
 * words were the reply.
 */
export async function recordTurnUsage(input: {
  userId: string;
  tripId: string;
  action: string | undefined;
  engine: { model: string; costUsd: number } | null;
  chatModel: ModelConfig;
  chat: { prompt: string; text: string } | null;
}): Promise<{ inputTokens: number; outputTokens: number; costCents: number }> {
  const { userId, tripId, action, engine, chatModel, chat } = input;
  const inputTokens = chat ? Math.ceil(chat.prompt.length / 4) : 0;
  const outputTokens = chat ? Math.ceil(chat.text.length / 4) : 0;
  const costCents = (chat ? estimateCost(chatModel, inputTokens, outputTokens) : 0) + (engine ? engine.costUsd * 100 : 0);

  await recordUsage({
    userId,
    tripId,
    modelId: !chat && engine ? engine.model : chatModel.id,
    action: action || "answer_question",
    inputTokens,
    outputTokens,
    costCents,
  });
  await incrementUsage(userId, "aiAssistantMessages", 1);

  return { inputTokens, outputTokens, costCents };
}
