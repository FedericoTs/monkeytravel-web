/**
 * Paste-a-plan extraction (F2 of docs/CONSTRAINT_PLANNER_PLAN.md).
 *
 * The traveller pastes the plan they already half-made — a WhatsApp
 * message from a friend, a Notes app draft, a forwarded itinerary — and
 * we turn it into `TripAnchor[]` so the generator fills the GAPS instead
 * of replacing the work. This is the third dogfood gap: "I already have a
 * trip partially planned and I want to fill the holes."
 *
 * Two layers, deliberately separated:
 *   1. THIS module — the Gemini call. Loose, fallible, returns raw shapes.
 *   2. lib/ai/anchor-import-core — pure normalization. Guarantees the
 *      output passes validateAnchors(), drops bad items with a reason.
 * Nothing here is trusted; everything crosses that boundary before it
 * reaches the constraint solver.
 *
 * Cost: $0.00 in Google Places spend (plan §6 is binding). This is a
 * single flash-lite text call — no geocoding, no Places, no Distance
 * Matrix. Anchor `location` stays free text exactly as the user wrote it.
 *
 * Mirrors lib/email-parse/extract.ts (the closest precedent: pasted text →
 * structured JSON via responseSchema), including its rule that transient
 * failures return typed errors rather than throwing.
 */
import { GoogleGenerativeAI, SchemaType, type ResponseSchema } from "@google/generative-ai";
import { getModelForPurpose } from "@/lib/ai/model-router";
import type { RawImportedAnchor } from "./anchor-import-core";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || "");

/**
 * Below this it's a fragment, not a plan — don't burn a model call.
 * Lower than the email parser's 100 because plans are terser than
 * confirmation emails ("Day 1 Venice, Day 3 wedding, Day 5 home" is a
 * legitimate 45-char paste).
 */
const MIN_TEXT_LENGTH = 25;

/** Plans are short. 8k chars is a very long pasted itinerary. */
const MAX_TEXT_CHARS = 8_000;

/** Model output cap — 20 anchors of ~40 tokens each, plus slack. */
const MAX_OUTPUT_TOKENS = 2_048;

export interface ExtractedPlan {
  /** Dated commitments → become anchors after normalization. */
  items: RawImportedAnchor[];
  /**
   * Plan items with NO day attached ("we want to see the Uffizi at some
   * point"). These CANNOT be anchors — an anchor is a date-pinned
   * constraint — but throwing them away would lose the user's work, which
   * is the exact failure F2 exists to fix. The UI offers them for the
   * free-text requirements box, where the generator can still honour them.
   */
  undated: string[];
}

export type PlanExtractError =
  | { error: "too_short" }
  | { error: "extract_failed" }
  | { error: "nothing_found" };

export type PlanExtractResult = ExtractedPlan | PlanExtractError;

export function isPlanExtractError(r: PlanExtractResult): r is PlanExtractError {
  return "error" in r;
}

const RESPONSE_SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    items: {
      type: SchemaType.ARRAY,
      description:
        "Every plan item that is pinned to a specific day. One entry per day per commitment.",
      items: {
        type: SchemaType.OBJECT,
        properties: {
          date: {
            type: SchemaType.STRING,
            description:
              "The day this item falls on. Use 'YYYY-MM-DD' when the text names a real date you can resolve. Use 'Day N' when the text only uses day numbers. Empty string if the item has no day.",
          },
          title: {
            type: SchemaType.STRING,
            description:
              "Short label for the commitment, in the user's own words where possible. E.g. 'Wedding ceremony', 'Flight to Venice', 'Hotel Aurora'.",
          },
          type: {
            type: SchemaType.STRING,
            format: "enum",
            enum: ["transport", "lodging", "event", "meetup", "custom"],
            description:
              "transport = flight/train/ferry/drive/transfer. lodging = where they SLEEP that night. event = a booked or scheduled occasion (wedding, concert, tour, reservation). meetup = meeting a specific person. custom = anything else.",
          },
          location: {
            type: SchemaType.STRING,
            description:
              "Place as written by the user ('Trieste', 'Venice Marco Polo', 'Hotel Aurora'). Empty string if absent. Never invent one.",
          },
          time: {
            type: SchemaType.STRING,
            description:
              "Time as written: '09:40', '9pm', 'morning', 'all day'. Empty string if the text gives no time.",
          },
        },
        required: ["date", "title", "type"],
      },
    },
    undated: {
      type: SchemaType.ARRAY,
      description:
        "Short labels for plan items the user mentions WITHOUT tying them to a day (wishes, ideas, 'we also want to...'). Empty array if none.",
      items: { type: SchemaType.STRING },
    },
  },
  required: ["items", "undated"],
};

const SYSTEM_PROMPT = `You are a travel-plan parser. The user pastes a plan they have already partly made. Your job is to capture what they have ALREADY DECIDED — not to plan anything.

RULES:
1. Output JSON matching the schema exactly. The runtime enforces it.
2. Extract ONLY what the text states. Never invent a commitment, a place, a time, or a date. If the text does not say it, it does not exist.
3. Every item pinned to a day goes in "items". Every item with no day goes in "undated" as a short label.
4. Dates: if the text names a resolvable calendar date, output ISO 'YYYY-MM-DD'. If it only says "Day 2" / "d2" / "second day", output 'Day 2'. Never guess a date the text does not support.
5. LODGING SPANS: if the text says they stay somewhere for several nights ("Hotel Aurora 11-13 Sept", "3 nights in Trieste"), emit ONE item PER NIGHT — from the first night through the night before checkout. Lodging is a per-night constraint, so a single item would only pin one day.
6. Do NOT merge two commitments into one item, and do NOT split one commitment across two items (except lodging spans, per rule 5).
7. Ignore prose that is not a plan item: greetings, prices, booking reference numbers, commentary, questions.
8. Keep titles short (under 80 characters) and in the user's own wording.
9. If the text contains no plan at all, return {"items":[],"undated":[]}.`;

/**
 * Extract a pasted plan into loosely-shaped items.
 *
 * The trip range is passed to the model as context so "Sept 11" and
 * "Day 4" both become resolvable — but resolution is re-done
 * deterministically in normalizeImportedAnchors(), which is what the
 * solver actually trusts. The model is a suggester, not an authority.
 *
 * Never throws on bad input or transient Gemini failures.
 */
export async function extractPlan(
  text: string,
  opts: { startDate: string; endDate: string; totalDays: number; destination?: string }
): Promise<PlanExtractResult> {
  if (!text || text.trim().length < MIN_TEXT_LENGTH) {
    return { error: "too_short" };
  }

  const cleaned = text.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim().slice(0, MAX_TEXT_CHARS);
  if (cleaned.length < MIN_TEXT_LENGTH) {
    return { error: "too_short" };
  }

  const model = genAI.getGenerativeModel({
    // anchor-import → flash-lite. Same shape of work as email-parser
    // (short text → small structured object) and the responseSchema
    // carries the contract, so the cheap tier is enough. Flip via
    // GEMINI_MODEL_OVERRIDE if extraction quality regresses.
    model: getModelForPurpose("anchor-import"),
    generationConfig: {
      temperature: 0.1,
      topP: 0.8,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    },
  });

  const context = [
    `Trip dates: ${opts.startDate} to ${opts.endDate} (Day 1 = ${opts.startDate}, ${opts.totalDays} days total).`,
    opts.destination ? `Destination: ${opts.destination}.` : "",
    "",
    "Plan pasted by the user:",
    "",
    cleaned,
  ]
    .filter(Boolean)
    .join("\n");

  let raw: string;
  try {
    const result = await model.generateContent({
      contents: [
        { role: "user", parts: [{ text: SYSTEM_PROMPT }] },
        {
          role: "model",
          parts: [
            {
              text: "Understood. I will capture only what the text already states, one item per day per commitment, and invent nothing.",
            },
          ],
        },
        { role: "user", parts: [{ text: context }] },
      ],
    });
    raw = result.response.text();
  } catch (err) {
    console.error("[anchor-import] Gemini call failed:", err);
    return { error: "extract_failed" };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error("[anchor-import] Non-JSON response:", raw.slice(0, 300), err);
    return { error: "extract_failed" };
  }

  const items = Array.isArray(parsed.items) ? (parsed.items as RawImportedAnchor[]) : [];
  const undated = Array.isArray(parsed.undated)
    ? (parsed.undated as unknown[])
        .filter((u): u is string => typeof u === "string" && u.trim().length > 0)
        .map((u) => u.trim().slice(0, 120))
        .slice(0, 20)
    : [];

  if (items.length === 0 && undated.length === 0) {
    return { error: "nothing_found" };
  }

  return { items, undated };
}
