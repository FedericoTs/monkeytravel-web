import type { GoogleGenerativeAI } from "@/lib/ai/genai-compat";
import { logCacheMetrics } from "@/lib/ai/cache-metrics";
import type { StructuredAssistantResponse } from "@/types";

/**
 * The trip assistant's chat model, asked `prompt`: its reply read as the
 * assistant's JSON, else its first 200 characters as the summary, and the raw
 * text (its length estimates the cost).
 */
export async function askChatModel(
  genAI: GoogleGenerativeAI,
  modelId: string,
  prompt: string
): Promise<{ reply: StructuredAssistantResponse; text: string }> {
  const model = genAI.getGenerativeModel({ model: modelId });
  const result = await model.generateContent(prompt);
  const text = result.response.text();

  // Wire prompt-cache hit-rate monitoring (see lib/ai/cache-metrics.ts). This is
  // the main chat-message call — buildSystemPrompt produces a long
  // stable preamble so this site should dominate the rolling window
  // with healthy cache hits.
  logCacheMetrics("ai.assistant.chat", result.response.usageMetadata);

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return { reply: JSON.parse(jsonMatch[0]), text };
    }
  } catch {
    // Not JSON after all: the plain text below.
  }
  return { reply: { summary: text.slice(0, 200), cards: [] }, text };
}
