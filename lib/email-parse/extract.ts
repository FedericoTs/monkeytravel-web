/**
 * Email confirmation parser (paste-to-extract).
 *
 * F2.simple — Users paste a booking confirmation email body (hotel,
 * flight, restaurant reservation) into a textarea on /trips/[id], we
 * send it through Gemini with a structured-output schema, and return a
 * normalized ParsedBooking the UI can preview before adding to the
 * itinerary.
 *
 * Strategic constraints (per F2.simple brief):
 * - No Gmail/Outlook OAuth — pure paste flow, zero OAuth verification.
 * - No vendor parsing service ($0 ongoing cost). Gemini 2.5 Flash with
 *   responseSchema is cheap, structured, and already configured.
 * - HTML strip + whitespace collapse client of Gemini — cuts ~30-40%
 *   of tokens off the typical email body (Booking.com / Airbnb
 *   confirmations are ~80% boilerplate HTML).
 *
 * The output mirrors the fields an Activity needs when an email-derived
 * booking gets turned into a trip activity by
 * /api/trips/[id]/activities/from-booking. The `kind` field maps onto
 * Activity.type at insert time.
 */

import { GoogleGenerativeAI, SchemaType, type ResponseSchema } from "@google/generative-ai";
import { getModelForPurpose } from "@/lib/ai/model-router";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || "");

/**
 * Normalized booking extracted from an email body.
 *
 * `startAt` / `endAt` are ISO 8601 strings (with timezone offset when the
 * email carries one — otherwise the local time the email shows). The UI
 * is responsible for slotting them into the right trip day.
 *
 * `raw_excerpt` is a 200-char slice of the original email that contains
 * the key details. Persisted on the activity so the user can audit
 * what we parsed without re-pasting the whole email.
 */
export type ParsedBooking = {
  kind: "hotel" | "flight" | "restaurant" | "activity" | "unknown";
  name: string;
  address?: string;
  city?: string;
  country?: string;
  coordinates?: { lat: number; lng: number };
  startAt: string;
  endAt?: string;
  confirmationNumber?: string;
  raw_excerpt: string;
};

/**
 * Error codes returned by extractBooking. Callers (and the API route)
 * surface them as user-facing messages, never as 5xx.
 */
export type ParseError =
  | { error: "too_short" }
  | { error: "parse_failed" }
  | { error: "no_booking_found" };

export type ParseResult = ParsedBooking | ParseError;

/**
 * Minimum length to bother calling Gemini. Below this it's almost
 * certainly garbage paste (single line, signature, blank email body)
 * and we'd just burn quota for nothing.
 */
const MIN_BODY_LENGTH = 100;

/**
 * Max payload sent to Gemini. Most confirmation emails fit in 3-6k
 * chars *after* HTML strip. We cap at 10k to keep the prompt cheap
 * while leaving headroom for verbose itineraries (long flight
 * confirmations with multi-leg routings).
 */
const MAX_BODY_CHARS = 10_000;

/**
 * Strip HTML tags + style/script blocks + collapse whitespace.
 * Saves ~30-40% tokens on real-world confirmation emails (which are
 * usually HTML soup wrapped around a few useful fields).
 *
 * Intentionally simple — we're feeding a textarea paste to an LLM, not
 * rendering a DOM. The LLM is robust to weird residuals.
 */
export function preprocessEmailBody(input: string): string {
  return input
    // Drop entire <script>/<style> blocks (and their contents).
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    // Drop HTML comments.
    .replace(/<!--[\s\S]*?-->/g, " ")
    // Replace common block-level tags with newlines so structure survives.
    .replace(/<\/(p|div|tr|li|h[1-6]|br)\s*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    // Strip remaining tags.
    .replace(/<[^>]+>/g, " ")
    // Decode the handful of HTML entities that actually appear in emails.
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Collapse runs of whitespace (but keep newlines as paragraph breaks).
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

/**
 * Gemini structured-output schema. Mirrors ParsedBooking closely; the
 * model is told to emit `kind="unknown"` and minimal name when it cannot
 * confidently extract anything.
 */
const RESPONSE_SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    kind: {
      type: SchemaType.STRING,
      format: "enum",
      enum: ["hotel", "flight", "restaurant", "activity", "unknown"],
      description:
        "Type of booking. 'flight' for any airline reservation, 'hotel' for any lodging including Airbnb/hostels, 'restaurant' for dining reservations, 'activity' for tours/tickets/experiences, 'unknown' if you can't determine a booking is being confirmed.",
    },
    name: {
      type: SchemaType.STRING,
      description:
        "Primary name of the booked entity: hotel name, restaurant name, airline+flight number ('Delta DL142'), or activity/tour name. Empty string if no booking detected.",
    },
    address: {
      type: SchemaType.STRING,
      description: "Full street address of the venue, if present in the email. Empty string if absent.",
    },
    city: {
      type: SchemaType.STRING,
      description: "City of the venue. Empty string if absent.",
    },
    country: {
      type: SchemaType.STRING,
      description: "Country of the venue. Empty string if absent.",
    },
    coordinates: {
      type: SchemaType.OBJECT,
      properties: {
        lat: { type: SchemaType.NUMBER },
        lng: { type: SchemaType.NUMBER },
      },
      description:
        "Latitude/longitude if the email explicitly contains them (rare). Omit entirely if not present — do NOT invent coordinates.",
    },
    startAt: {
      type: SchemaType.STRING,
      description:
        "Start time as ISO 8601 with timezone offset if present (e.g. '2026-08-14T15:00:00+02:00'), or local-time ISO if no timezone is given. For hotels this is check-in. For flights this is departure. For restaurants this is reservation time.",
    },
    endAt: {
      type: SchemaType.STRING,
      description:
        "End time as ISO 8601. For hotels: check-out. For flights: arrival. For restaurants: usually omit unless explicitly stated. Empty string if not applicable.",
    },
    confirmationNumber: {
      type: SchemaType.STRING,
      description:
        "Booking confirmation / PNR / reservation number. Empty string if not present.",
    },
    raw_excerpt: {
      type: SchemaType.STRING,
      description:
        "A 100-200 char excerpt from the original email containing the key details (name, date, confirmation). Useful for user verification.",
    },
  },
  required: ["kind", "name", "startAt", "raw_excerpt"],
};

const SYSTEM_PROMPT = `You are a booking-confirmation parser. The user has pasted the body of a booking confirmation email. Extract structured fields.

RULES:
1. Output JSON matching the exact schema. The runtime enforces it — do not add or rename keys.
2. If the email is NOT a booking confirmation (newsletter, marketing, support thread, generic correspondence), set kind="unknown", name="", startAt="" — leave optional fields empty. The runtime returns "no_booking_found" to the user.
3. Do NOT invent fields. If the email does not contain an address, return an empty address — do not guess from the venue name.
4. Do NOT invent coordinates. Omit the coordinates field unless lat/lng literally appear in the email text.
5. Dates: prefer ISO 8601 with timezone offset (e.g. '2026-08-14T15:00:00+02:00'). If no timezone is shown, output local-time ISO ('2026-08-14T15:00:00'). NEVER output a date you cannot find in the email.
6. raw_excerpt MUST be a verbatim slice of the input — do not summarize or paraphrase.
7. For multi-leg flights pick the FIRST leg (departure). The user will add other legs separately.
8. For hotel ranges, startAt = check-in, endAt = check-out. Both required.`;

/**
 * Extract a structured booking from a pasted email body.
 *
 * Resolves to a ParsedBooking on success or a ParseError on any of:
 *   - 'too_short'        — input shorter than MIN_BODY_LENGTH chars
 *   - 'no_booking_found' — Gemini reported kind="unknown" (or empty name)
 *   - 'parse_failed'     — Gemini call threw, returned non-JSON, etc.
 *
 * Never throws on bad input or transient Gemini failures — callers get a
 * typed error they can render. Real throws only escape on misconfig
 * (e.g. missing GOOGLE_AI_API_KEY).
 */
export async function extractBooking(emailBody: string): Promise<ParseResult> {
  if (!emailBody || emailBody.trim().length < MIN_BODY_LENGTH) {
    return { error: "too_short" };
  }

  const cleaned = preprocessEmailBody(emailBody).slice(0, MAX_BODY_CHARS);

  // Re-check after preprocessing — an HTML-only email (rare but possible)
  // could collapse below the threshold once tags are stripped.
  if (cleaned.length < MIN_BODY_LENGTH) {
    return { error: "too_short" };
  }

  const model = genAI.getGenerativeModel({
    // email-parser → routed via model-router (gemini-2.5-flash-lite per
    // the 2026-05-31 audit). Historical note: the original code used
    // flash for "reliable structured output" — but with the responseSchema
    // contract enforcing the shape, flash-lite is enough and ~3x cheaper.
    // If we see a regression in extraction quality we can flip
    // GEMINI_MODEL_OVERRIDE=gemini-2.5-flash as a hot fix.
    model: getModelForPurpose("email-parser"),
    generationConfig: {
      temperature: 0.1, // Low — we want deterministic field extraction.
      topP: 0.8,
      responseMimeType: "application/json",
      // Structured-output mode: forces the model to emit JSON that
      // matches RESPONSE_SCHEMA. Cuts down on parse failures massively
      // vs free-form JSON in the prompt.
      responseSchema: RESPONSE_SCHEMA,
    },
  });

  let text: string;
  try {
    const result = await model.generateContent({
      contents: [
        { role: "user", parts: [{ text: SYSTEM_PROMPT }] },
        {
          role: "model",
          parts: [
            {
              text: "Understood. I will extract booking fields as JSON matching the provided schema, with no invented values.",
            },
          ],
        },
        {
          role: "user",
          parts: [
            {
              text: `Email body to parse:\n\n${cleaned}`,
            },
          ],
        },
      ],
    });
    text = result.response.text();
  } catch (err) {
    console.error("[email-parse/extract] Gemini call failed:", err);
    return { error: "parse_failed" };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    console.error(
      "[email-parse/extract] Non-JSON Gemini response:",
      text.slice(0, 300),
      err
    );
    return { error: "parse_failed" };
  }

  return normalizeParsedBooking(parsed);
}

/**
 * Normalize Gemini's response into a ParsedBooking, or return
 * `no_booking_found` if the model couldn't extract anything useful.
 *
 * Exported for unit testing — the route handler should not call this
 * directly.
 */
export function normalizeParsedBooking(raw: Record<string, unknown>): ParseResult {
  const kindRaw = typeof raw.kind === "string" ? raw.kind.toLowerCase().trim() : "";
  const allowedKinds: ParsedBooking["kind"][] = [
    "hotel",
    "flight",
    "restaurant",
    "activity",
    "unknown",
  ];
  const kind = (allowedKinds as string[]).includes(kindRaw)
    ? (kindRaw as ParsedBooking["kind"])
    : "unknown";

  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const startAt = typeof raw.startAt === "string" ? raw.startAt.trim() : "";

  // Reject anything Gemini flagged as not-a-booking or that lacks the
  // bare-minimum fields (name + start time). The UI shows a "we
  // couldn't find a booking — paste a clearer email" message.
  if (kind === "unknown" || !name || !startAt) {
    return { error: "no_booking_found" };
  }

  const result: ParsedBooking = {
    kind,
    name,
    startAt,
    raw_excerpt:
      typeof raw.raw_excerpt === "string" && raw.raw_excerpt.trim()
        ? raw.raw_excerpt.trim().slice(0, 400)
        : "",
  };

  if (typeof raw.address === "string" && raw.address.trim()) {
    result.address = raw.address.trim();
  }
  if (typeof raw.city === "string" && raw.city.trim()) {
    result.city = raw.city.trim();
  }
  if (typeof raw.country === "string" && raw.country.trim()) {
    result.country = raw.country.trim();
  }
  if (typeof raw.endAt === "string" && raw.endAt.trim()) {
    result.endAt = raw.endAt.trim();
  }
  if (
    typeof raw.confirmationNumber === "string" &&
    raw.confirmationNumber.trim()
  ) {
    result.confirmationNumber = raw.confirmationNumber.trim();
  }

  // Coordinates — accept only if both lat/lng are finite numbers in the
  // valid geographic ranges. Defensively reject 0,0 (the "model hallucinated
  // a default" tell).
  const coords = raw.coordinates as
    | { lat?: unknown; lng?: unknown }
    | undefined;
  if (coords && typeof coords === "object") {
    const lat = Number(coords.lat);
    const lng = Number(coords.lng);
    if (
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      lat >= -90 &&
      lat <= 90 &&
      lng >= -180 &&
      lng <= 180 &&
      !(lat === 0 && lng === 0)
    ) {
      result.coordinates = { lat, lng };
    }
  }

  return result;
}

/**
 * Type guard so route handlers / UI can branch without re-checking the
 * 'error' key in scattered places.
 */
export function isParseError(result: ParseResult): result is ParseError {
  return typeof (result as ParseError).error === "string";
}
