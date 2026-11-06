import "server-only";
import { recordGeminiUsage } from "@/lib/ai/gemini-cost";
import { GoogleGenerativeAI } from "@/lib/ai/genai-compat";
import { getModelForPurpose } from "@/lib/ai/model-router";
import type { Activity } from "@/types";

/**
 * One nearby alternative for an activity — Live Trip Phase 3.3, the "Swap
 * nearby" chip. A live traveller taps it and gets a single, concrete
 * suggestion in the same area and category, with one line of why.
 *
 * Cheapest model (activity-regenerate tier), JSON mode, one short prompt.
 * Fail-soft: returns null on any error so the chip degrades to "no suggestion
 * right now" rather than 500-ing the whole action.
 */
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || "");

// The page supplies these, and each character is paid for.
const MAX_FIELD_CHARS = 200;
const clip = (text: string) => text.slice(0, MAX_FIELD_CHARS);

export interface NearbyAlternative {
  name: string;
  why: string;
}

export async function suggestNearbyAlternative(
  activity: Pick<Activity, "name" | "type" | "location" | "address">,
  destination: string,
  language = "en",
): Promise<NearbyAlternative | null> {
  if (!process.env.GOOGLE_AI_API_KEY) return null;
  const area = clip(activity.location || activity.address || destination);
  const prompt =
    `A traveller in ${clip(destination)} wants a different option instead of "${clip(activity.name)}"` +
    (activity.type ? ` (a ${clip(activity.type)})` : "") +
    ` near ${area}. Suggest ONE real, well-known alternative of the same kind in the same area, and one short reason.\n` +
    `Answer in ${language}. Return JSON: {"name": string, "why": string}. "why" must be at most 12 words.`;
  try {
    const modelId = getModelForPurpose("activity-regenerate");
    const model = genAI.getGenerativeModel({
      model: modelId,
      generationConfig: { responseMimeType: "application/json", temperature: 0.6, maxOutputTokens: 120 },
    });
    const res = await model.generateContent(prompt);
    recordGeminiUsage(modelId, res.response.usageMetadata);
    const parsed = JSON.parse(res.response.text()) as { name?: unknown; why?: unknown };
    const name = typeof parsed.name === "string" ? parsed.name.trim().slice(0, 80) : "";
    const why = typeof parsed.why === "string" ? parsed.why.trim().slice(0, 120) : "";
    if (!name) return null;
    return { name, why };
  } catch (err) {
    console.warn("[nearby-alternative] failed:", err);
    return null;
  }
}
