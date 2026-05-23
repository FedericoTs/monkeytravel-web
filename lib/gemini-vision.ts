/**
 * "Start Anywhere" — Gemini Vision extraction of trip context from an
 * image, screenshot, or web page.
 *
 * Inspired by Mindtrip's "Start Anywhere" feature, which is the single
 * most copy-worthy idea in the competitive field per the 2026-05-23
 * benchmark. A visitor pastes a TikTok screenshot, a Pinterest board,
 * a news article URL, or a photo from their camera roll — and we extract
 * a starter trip config (destination, suggested dates, vibes) that
 * pre-fills the wizard. Drops "I want to go somewhere like this" from
 * a 5-minute Google session to a single click.
 *
 * Uses Gemini 2.5 Flash (multimodal). Output is structured JSON validated
 * before being returned, so downstream callers can treat the response
 * as typed.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { MODELS } from "./gemini";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || "");

const EXTRACTION_PROMPT = `You are a travel-research assistant. The user has shared an image, screenshot, or web page they're inspired by. Extract a starter trip plan from it.

Return a JSON object with these fields:
- "destination": the city + country shown or referenced. If multiple destinations appear, pick the one most prominent in the image/text. Required.
- "destinationConfidence": 0.0-1.0 confidence in the destination. 1.0 = the image literally says the place name; 0.5 = inferred from landmark or visual cues; 0.2 = guessing.
- "vibes": array of 1-4 from this exact list: ["adventure","cultural","foodie","romantic","nature","urban"]. Pick what the image evokes.
- "suggestedDurationDays": integer 2-14. Reasonable trip length based on the destination's scope. Default 5 if unclear.
- "monthHint": month name in English (e.g. "April") if the image clearly shows a season (cherry blossoms = March/April, snow = December/January, autumn leaves = October). Otherwise null.
- "notes": one short sentence (<25 words) summarizing what made you pick those values. Reader will see this as "Why we suggested...".

CRITICAL RULES:
1. Output ONLY the JSON object. No prose, no markdown fence, no preamble.
2. If you cannot confidently identify ANY destination — return {"destination":null,"destinationConfidence":0,"vibes":[],"suggestedDurationDays":5,"monthHint":null,"notes":"Could not identify a destination from this input. Try a clearer photo or paste a URL with a destination name."}
3. NSFW, copyrighted material, or images of identifiable private people unrelated to travel: also return the "could not identify" response above.
4. Don't invent specifics. If the image shows a beach but no specific beach, say "destination":"Mediterranean coast" with low confidence, not a made-up town name.`;

export interface ExtractedTripContext {
  /** City + country, e.g. "Tokyo, Japan". Null if unidentifiable. */
  destination: string | null;
  /** 0.0–1.0 confidence in the destination identification */
  destinationConfidence: number;
  /** Subset of ["adventure","cultural","foodie","romantic","nature","urban"] */
  vibes: string[];
  /** Reasonable trip length 2-14 days */
  suggestedDurationDays: number;
  /** Month name in English (e.g. "April") if season is implied; null otherwise */
  monthHint: string | null;
  /** Short human-readable explanation of the picks (<25 words) */
  notes: string;
}

export interface ExtractInput {
  /** A data URL or absolute https URL pointing at an image */
  imageUrl?: string;
  /** Raw base64 image bytes (no data: prefix) — alternative to imageUrl */
  imageBase64?: string;
  /** Mime type for imageBase64. Defaults to image/jpeg */
  imageMimeType?: string;
  /** A web page URL to scrape for trip clues (text-only — image fetching is the caller's job) */
  websiteText?: string;
  /** Optional context the caller wants to inject (e.g. "user is in Italy") */
  userContext?: string;
}

const ALLOWED_VIBES = new Set([
  "adventure",
  "cultural",
  "foodie",
  "romantic",
  "nature",
  "urban",
]);

/**
 * Validate + normalize the model's response. Permissive — if the model
 * deviates, we clamp/fix rather than throw, so a partial extraction is
 * still useful to the user.
 */
function sanitizeResult(raw: unknown): ExtractedTripContext {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const destination =
    typeof obj.destination === "string" && obj.destination.trim().length > 0
      ? obj.destination.trim()
      : null;

  const conf = Number(obj.destinationConfidence);
  const destinationConfidence = Number.isFinite(conf)
    ? Math.max(0, Math.min(1, conf))
    : 0;

  const rawVibes = Array.isArray(obj.vibes) ? obj.vibes : [];
  const vibes = rawVibes
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.toLowerCase().trim())
    .filter((v) => ALLOWED_VIBES.has(v))
    .slice(0, 4);

  const dur = Number(obj.suggestedDurationDays);
  const suggestedDurationDays = Number.isFinite(dur)
    ? Math.max(2, Math.min(14, Math.round(dur)))
    : 5;

  const monthHint =
    typeof obj.monthHint === "string" && obj.monthHint.trim().length > 0
      ? obj.monthHint.trim()
      : null;

  const notes =
    typeof obj.notes === "string" && obj.notes.trim().length > 0
      ? obj.notes.trim().slice(0, 200)
      : "";

  return { destination, destinationConfidence, vibes, suggestedDurationDays, monthHint, notes };
}

/**
 * Extract trip context from an image and/or website text. Returns the
 * model's best guess wrapped in a stable shape.
 *
 * Throws if Gemini itself fails (network, quota, content blocked). Callers
 * should wrap with try/catch; on failure, the route returns a clean 502.
 */
export async function extractTripContext(
  input: ExtractInput
): Promise<ExtractedTripContext> {
  if (!input.imageUrl && !input.imageBase64 && !input.websiteText) {
    throw new Error("extract: at least one of imageUrl/imageBase64/websiteText is required");
  }

  const model = genAI.getGenerativeModel({
    model: MODELS.premium, // Flash, not flash-lite — vision quality matters here
    generationConfig: {
      temperature: 0.3, // Low for factual extraction
      topP: 0.8,
      responseMimeType: "application/json",
    },
  });

  // Build the contents array: text prompt + (image|text)
  // The SDK accepts mixed parts in a single user turn.
  const parts: Array<
    | { text: string }
    | { inlineData: { data: string; mimeType: string } }
    | { fileData: { fileUri: string; mimeType: string } }
  > = [{ text: EXTRACTION_PROMPT }];

  if (input.userContext) {
    parts.push({ text: `Additional context from the user: ${input.userContext}` });
  }

  if (input.imageBase64) {
    parts.push({
      inlineData: {
        data: input.imageBase64,
        mimeType: input.imageMimeType || "image/jpeg",
      },
    });
  } else if (input.imageUrl) {
    // Gemini supports HTTPS image URLs via fileData. For data: URLs we'd
    // need to convert to base64 — caller's responsibility to use the
    // imageBase64 path for those.
    if (input.imageUrl.startsWith("data:")) {
      throw new Error("extract: pass data URLs via imageBase64, not imageUrl");
    }
    parts.push({
      fileData: {
        fileUri: input.imageUrl,
        mimeType: input.imageMimeType || "image/jpeg",
      },
    });
  }

  if (input.websiteText) {
    parts.push({
      text: `Text scraped from the user's referenced web page (first 4000 chars):\n${input.websiteText.slice(0, 4000)}`,
    });
  }

  const response = await model.generateContent({
    contents: [{ role: "user", parts }],
  });

  const text = response.response.text();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    console.error("[gemini-vision] non-JSON response:", text.slice(0, 200));
    throw new Error("Gemini Vision returned non-JSON output");
  }

  return sanitizeResult(parsed);
}
