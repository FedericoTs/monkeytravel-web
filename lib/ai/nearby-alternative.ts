import "server-only";
import { GoogleGenerativeAI } from "@google/generative-ai";
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
  const area = activity.location || activity.address || destination;
  const prompt =
    `A traveller in ${destination} wants a different option instead of "${activity.name}"` +
    (activity.type ? ` (a ${activity.type})` : "") +
    ` near ${area}. Suggest ONE real, well-known alternative of the same kind in the same area, and one short reason.\n` +
    `Answer in ${language}. Return JSON: {"name": string, "why": string}. "why" must be at most 12 words.`;
  try {
    const model = genAI.getGenerativeModel({
      model: getModelForPurpose("activity-regenerate"),
      generationConfig: { responseMimeType: "application/json", temperature: 0.6, maxOutputTokens: 120 },
    });
    const res = await model.generateContent(prompt);
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
