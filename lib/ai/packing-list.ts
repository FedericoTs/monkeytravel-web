/**
 * AI-generated packing list for a trip.
 *
 * Lightweight Gemini Flash call with strict JSON output. Cheap (~$0.0002
 * per request, no images), fast (<3s), and free for users — designed as
 * a lead-magnet tool that captures emails before exporting the PDF.
 *
 * Distinct from the main trip-itinerary generator on a few axes:
 *   - No grounding / Maps API → pure model output, no external cost
 *   - No streaming → single short response
 *   - Small/cheap model (gemini-2.5-flash-lite) — packing lists don't
 *     need the smarter model
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { logCacheMetrics } from "@/lib/gemini";
import { getModelForPurpose } from "@/lib/ai/model-router";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || "");

export interface PackingListInput {
  destination: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  travelStyle:
    | "city"
    | "beach"
    | "adventure"
    | "business"
    | "wellness"
    | "mixed";
  activities?: string[]; // optional checklist like ["hiking", "swimming", "fine_dining"]
  /** Locale for output text (en/it/es). Falls back to en. */
  locale?: "en" | "it" | "es";
}

export interface PackingItem {
  name: string;
  /** Optional short note ("for evening dinners", "Type C/F outlet") */
  note?: string;
  /** True for items that frequently get forgotten — surface in UI */
  essential?: boolean;
}

export type PackingCategoryId =
  | "documents"
  | "clothing"
  | "toiletries"
  | "electronics"
  | "activity_gear"
  | "health"
  | "misc";

export interface PackingListResult {
  categories: Array<{
    /** Stable English key for the category — UI maps to localized label */
    id: PackingCategoryId;
    /**
     * Localized display label for the category, populated by the route
     * handler via next-intl. The lib doesn't depend on next-intl, so
     * categories returned directly from `generatePackingList` will have
     * `label` undefined — the route is responsible for filling it in.
     */
    label?: string;
    items: PackingItem[];
  }>;
  /** One-liner sourced from the prompt: weather summary + key local notes */
  contextNote: string;
}

const LOCALE_NAME: Record<NonNullable<PackingListInput["locale"]>, string> = {
  en: "English",
  it: "Italian",
  es: "Spanish",
};

/**
 * Per-locale example contextNote demonstrating the expected length and
 * richness. Pre-2026-05-31 the prompt only showed the EN example — IT/ES
 * generations came back ~25% the length (often a single dependent clause,
 * sometimes empty for ES) because the model anchored on the example.
 * Now we anchor each locale on its own native-language reference so the
 * model treats fluent length parity as the target. Keep these long
 * enough (~30+ words) that the model doesn't truncate.
 */
const CONTEXT_NOTE_EXAMPLE: Record<
  NonNullable<PackingListInput["locale"]>,
  string
> = {
  en:
    "Late May in Tokyo: warm and humid days around 22-27°C with a real chance of evening showers, so pack a packable rain shell. Outlets are Type A (100V) — bring a small adapter for any 220V appliances. Dress modestly when visiting temples (covered shoulders and knees).",
  it:
    "Fine maggio a Tokyo: giornate calde e umide tra i 22 e i 27°C con buone probabilità di rovesci serali, quindi metti in valigia un guscio antipioggia compatto. Le prese sono di Tipo A (100V) — porta un piccolo adattatore per qualsiasi dispositivo a 220V. Vestiti in modo sobrio quando visiti i templi (spalle e ginocchia coperte).",
  es:
    "Finales de mayo en Tokio: días cálidos y húmedos entre 22 y 27°C con bastantes probabilidades de chubascos por la tarde, así que lleva una chaqueta impermeable plegable. Los enchufes son de Tipo A (100V) — lleva un pequeño adaptador para cualquier aparato de 220V. Vístete con discreción al visitar los templos (hombros y rodillas cubiertos).",
};

function buildPrompt(input: PackingListInput): string {
  const days =
    Math.ceil(
      (new Date(input.endDate).getTime() - new Date(input.startDate).getTime()) /
        (1000 * 60 * 60 * 24)
    ) + 1;
  const locale = input.locale || "en";
  const language = LOCALE_NAME[locale];
  const contextExample = CONTEXT_NOTE_EXAMPLE[locale];
  const activities = (input.activities || []).join(", ") || "general sightseeing";

  return `You are an experienced travel writer who has packed for hundreds of trips.
Generate a personalized packing list as STRICT JSON (no markdown, no extra text).

Trip details:
- Destination: ${input.destination}
- Travel dates: ${input.startDate} to ${input.endDate} (${days} day${days === 1 ? "" : "s"})
- Travel style: ${input.travelStyle}
- Planned activities: ${activities}

Output language: ${language}. Every user-visible string (item "name", item
"note", and the "contextNote") MUST be written in fluent, native-quality
${language}. Do NOT mix languages. Do NOT shorten or summarize the
${language} text — write with the same level of detail, nuance, and
sentence count you would for an English reader. Length and richness of
the ${language} output must match what an equivalent English version
would have: if EN gets three sentences with weather + outlets + cultural
notes, ${language} also gets three sentences with weather + outlets +
cultural notes.

Return this exact JSON shape:
{
  "categories": [
    {
      "id": "documents" | "clothing" | "toiletries" | "electronics" | "activity_gear" | "health" | "misc",
      "items": [
        { "name": "Passport", "note": "Check 6-month validity", "essential": true }
      ]
    }
  ],
  "contextNote": "2-4 sentence briefing covering (a) weather/climate for the dates, (b) outlet/plug type + voltage, (c) any cultural or practical note. Written in ${language}."
}

Reference contextNote in ${language} (this is the target length AND
quality — your contextNote must be similar in length, sentence count,
and informational density; never shorter, never empty):

"${contextExample}"

Rules:
1. JSON only. No \`\`\`, no prose around it.
2. Include 6 categories in this order: documents, clothing, toiletries, electronics, activity_gear, health.
   Add "misc" only if you have items that don't fit the other 6.
3. Each category: 4-10 items. Tailor item count to trip length (3-day weekender = lean,
   14-day backpacking = more items). Account for laundry on longer trips.
4. Tailor to the destination:
   - Plug/outlet type for that country (Type A/B/C/F/G/I, voltage)
   - Climate-specific layers (rainy/cold/hot/humid/dry)
   - Cultural notes (e.g., modest clothing for temples in Bali, evening jacket in Paris)
   - Local pharmacy availability — flag must-bring meds vs locally available
5. Mark items \`essential: true\` ONLY for items that:
   - Are commonly forgotten (passport, charger, prescription meds), OR
   - Are hard to source at the destination, OR
   - Are critical for the planned activities (hiking boots for a hiking trip)
6. Notes are optional. Use them when they add real value (size, plug type, "for X scenario"),
   not just to repeat the name. Keep notes under 60 characters.
7. All user-visible text must be in ${language}. The "id" keys stay in English.
8. NEVER include items that would be illegal or controlled substances at the destination.
   If the destination has unusual restrictions (e.g., medication imports), add a note in
   contextNote.
9. contextNote MUST be a non-empty string of at least 2 sentences in
   ${language}. Never return an empty string. Never return a single
   short fragment. Match the length and sentence count of the reference
   example above.`;
}

/**
 * Call Gemini Flash for a personalized packing list. Returns parsed JSON
 * or throws if the model output is malformed.
 */
export async function generatePackingList(
  input: PackingListInput
): Promise<PackingListResult> {
  if (!process.env.GOOGLE_AI_API_KEY) {
    throw new Error("GOOGLE_AI_API_KEY not configured");
  }

  const model = genAI.getGenerativeModel({
    // packing-list → gemini-2.5-flash-lite (deterministic list, cheap).
    model: getModelForPurpose("packing-list"),
    generationConfig: {
      // 2026-05-31: lowered from 0.4 → 0.2 (deterministic utility task).
      // Packing lists for the same destination/dates/preferences should be
      // near-identical across calls — that's a feature, not a bug. Tighter
      // sampling → higher prompt-cache hit rate, lower output cost, and
      // reproducible behavior for E2E tests. Personality lives in the
      // prompt template, not in the sampler.
      temperature: 0.2,
      responseMimeType: "application/json",
      maxOutputTokens: 2048,
    },
  });

  const response = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: buildPrompt(input) }] }],
  });

  // Wire prompt-cache hit-rate monitoring (see lib/gemini.ts).
  // Without this, silent regressions on the packing-list prompt prefix
  // (e.g. a future timestamp injection) would burn input-token cost
  // invisibly. Cheap call — just emits to console + rolling Sentry alert.
  logCacheMetrics("tools.packing-list", response.response.usageMetadata);

  const raw = response.response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Gemini returned non-JSON output");
  }

  // Validate shape — we don't need exhaustive checks, just enough to
  // catch obvious model failures.
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as Record<string, unknown>).categories)
  ) {
    throw new Error("Gemini output missing categories array");
  }

  const result = parsed as PackingListResult;

  // Defensive backfill: even with the explicit prompt rules above, the
  // Lite model occasionally returns an empty contextNote — especially in
  // ES. Rather than ship a blank amber callout in the UI, synthesize a
  // minimal locale-appropriate fallback so the briefing card always
  // renders something useful. This is a last-resort and should fire
  // rarely; the prompt is the primary fix.
  if (!result.contextNote || result.contextNote.trim().length === 0) {
    const locale = input.locale || "en";
    const fallback: Record<NonNullable<PackingListInput["locale"]>, string> = {
      en: `Plan for variable weather over your ${input.destination} trip and check the local outlet type before packing chargers. Bring layers and a compact rain shell as a precaution.`,
      it: `Preparati a un clima variabile durante il tuo viaggio a ${input.destination} e verifica il tipo di presa elettrica locale prima di mettere in valigia i caricatori. Porta abiti a strati e un guscio antipioggia compatto per sicurezza.`,
      es: `Prepárate para un clima variable durante tu viaje a ${input.destination} y verifica el tipo de enchufe local antes de empacar los cargadores. Lleva ropa por capas y una chaqueta impermeable compacta por precaución.`,
    };
    result.contextNote = fallback[locale];
  }

  return result;
}
