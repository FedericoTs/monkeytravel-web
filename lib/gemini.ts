import { GoogleGenerativeAI } from "@/lib/ai/genai-compat";
import type { GeneratedItinerary, TripCreationParams, TripVibe, Activity, ItineraryDay, UserProfilePreferences } from "@/types";
import { generateActivityId } from "./utils/activity-id";
import { getPrompt } from "./prompts";
import { captureLLMGeneration, type GeminiUsageMetadata } from "./posthog/llm-analytics";
import { getModelForPurpose, getSiblingModel, thinkingConfigFor } from "./ai/model-router";
import { logCacheMetrics } from "./ai/cache-metrics";
import type { SupportedLanguage } from "./ai/language";
import {
  withDeduplication,
  getItineraryDedupKey,
  getActivityDedupKey,
  getDayDedupKey,
} from "./gemini-dedup";
import { paceBudgetPromptClause } from "./trip/pace";
import { validateAndFixCoordinates } from "./trip/coordinate-fallback";
import { ACTIVITY_TYPES, normalizeActivityType } from "./trip/activity-type";
import { addIsoDays, tripSpanDays } from "./dates/iso-date";
import type { OutlineDay } from "./ai/trip-outline";
import type { KnownPlace } from "./ai/known-places";
import { withServerFields } from "./ai/server-fields";
import { inPlanCurrency } from "./ai/plan-currency";
import { planCurrency } from "./ai/assistant/plan-costs";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || "");

// Per-attempt timeout for AI requests. 50s covers the P99 latency of an
// 8K-token response (~45s); itineraryTimeoutMs raises it for trips over 7 days.
// At most two attempts (MAX_RETRIES = 1, 1s pause after an API error), so at
// 50s the worst case, 50 + 1 + 50 = 101s, fits the generate route's 120s
// maxDuration (vercel.json). One retry only: a timed-out attempt usually means
// Gemini is stuck on that prompt and re-sending it rarely recovers; the
// lower-temperature retry still catches transient blips.
const AI_REQUEST_TIMEOUT_MS = 50_000;

/**
 * How long to allow ONE itinerary generation, scaled by trip length.
 *
 * 50s suits the median 3-5 day trip, but a 14-day trip emits roughly three
 * times the tokens, and a fixed ceiling turns "slow" into "broken" for exactly
 * the trips that are hardest to produce. Capped at 90s so a single attempt
 * still fits inside the route's 120s Vercel maxDuration with room for the
 * surrounding work.
 */
export function itineraryTimeoutMs(days?: number): number {
  if (!days || days <= 7) return AI_REQUEST_TIMEOUT_MS;
  return Math.min(90_000, AI_REQUEST_TIMEOUT_MS + (days - 7) * 6_000);
}

/**
 * Backfill a missing or partial trip_summary so downstream consumers
 * (wizard render, persistTrip) don't crash when the model truncates the
 * response before emitting the summary block: tryRepairTruncatedJSON can
 * recover valid `days` with no trailing trip_summary. Safe defaults let the
 * UI render; users can edit the budget after save.
 *
 * Mutates the input and returns it.
 */
function ensureTripSummary(itinerary: GeneratedItinerary): GeneratedItinerary {
  const existing = (itinerary as { trip_summary?: Partial<GeneratedItinerary["trip_summary"]> })
    .trip_summary;
  itinerary.trip_summary = {
    total_estimated_cost:
      typeof existing?.total_estimated_cost === "number" ? existing.total_estimated_cost : 0,
    currency: typeof existing?.currency === "string" ? existing.currency : "USD",
    highlights: Array.isArray(existing?.highlights) ? existing.highlights : [],
    packing_suggestions: Array.isArray(existing?.packing_suggestions)
      ? existing.packing_suggestions
      : [],
  };
  return itinerary;
}

/**
 * Attempt to repair truncated/malformed JSON from Gemini.
 *
 * A response that hits maxOutputTokens mid-string or mid-array is broken
 * JSON, and retries don't help — same prompt + same cap = same truncation.
 * Better to recover a shorter-but-valid itinerary than 500 the user.
 *
 * Strategy: walk char-by-char tracking string state and bracket depth.
 * If we end inside a string or with unclosed structures, close them in
 * reverse order. Returns null when the brackets already balance (the parse
 * error is something else) or when structure is too broken to safely
 * recover (mismatched brackets etc).
 *
 * Trade-off: a "repaired" itinerary may be missing the last day(s) or
 * have a truncated final activity; validateAndFixCoordinates() and
 * ensureTripSummary() backfill defaults. Callers log a Sentry breadcrumb
 * per repair so the frequency stays visible.
 */
function tryRepairTruncatedJSON(raw: string): string | null {
  // Strip markdown code fences if Gemini added them despite our instructions.
  let s = raw.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  }
  if (!s) return null;

  let inString = false;
  let escape = false;
  const stack: string[] = []; // tracks '{' and '['
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escape) { escape = false; continue; }
    if (c === "\\") { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === "{" || c === "[") stack.push(c);
    else if (c === "}") {
      if (stack[stack.length - 1] !== "{") return null; // mismatched
      stack.pop();
    } else if (c === "]") {
      if (stack[stack.length - 1] !== "[") return null; // mismatched
      stack.pop();
    }
  }
  // Already balanced — nothing to repair (parse error must be something else).
  if (stack.length === 0 && !inString) return null;

  let repaired = s;
  // Drop trailing escape backslash so we don't end with "\
  if (repaired.endsWith("\\")) repaired = repaired.slice(0, -1);
  // Close unterminated string.
  if (inString) repaired += '"';
  // Strip dangling comma / colon / partial key before adding closers.
  repaired = repaired.replace(/[,:\s]+$/, "");
  // If we stripped down to a dangling key like "foo" — strip the orphan key+separator.
  // Keep stripping orphans: `, "key"` -> remove ", \"key\"" suffix patterns.
  repaired = repaired.replace(/,\s*"[^"]*"\s*$/, "");
  // Close all open brackets in reverse order.
  while (stack.length > 0) {
    const open = stack.pop();
    repaired += open === "{" ? "}" : "]";
  }
  return repaired;
}

/**
 * Race a promise against a timeout. Throws if the timeout expires first.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
    ),
  ]);
}

// The trip-generation system prompt loads from the database via getPrompt();
// lib/prompts.ts holds the defaults and the database integration.

/**
 * Build profile preferences section for the prompt
 * Includes dietary restrictions, travel styles, and accessibility needs
 */
function buildProfilePreferencesSection(profilePreferences?: UserProfilePreferences): string {
  if (!profilePreferences) return "";

  const sections: string[] = [];

  // Dietary preferences - CRITICAL for food recommendations
  if (profilePreferences.dietaryPreferences && profilePreferences.dietaryPreferences.length > 0) {
    const dietLabels: Record<string, string> = {
      "vegetarian": "Vegetarian (no meat or fish)",
      "vegan": "Vegan (no animal products)",
      "halal": "Halal (Islamic dietary laws)",
      "kosher": "Kosher (Jewish dietary laws)",
      "gluten-free": "Gluten-Free",
    };
    const formatted = profilePreferences.dietaryPreferences.map(d => dietLabels[d] || d).join(", ");
    sections.push(`- Dietary Requirements: ${formatted}
  IMPORTANT: every place to eat or drink (restaurants, cafés, bars, markets, food tours) MUST suit these needs. Choose real, named, long-established places well known for these options, not new or little-known ones; a popular restaurant with clearly marked dishes for these needs is a good choice. In each one's description, say what the traveller can eat there.`);
  }

  // Accessibility needs - affects venue selection
  if (profilePreferences.accessibilityNeeds && profilePreferences.accessibilityNeeds.length > 0) {
    const accessLabels: Record<string, string> = {
      "wheelchair": "Wheelchair accessible",
      "limited-mobility": "Limited mobility (avoid stairs, long walks)",
      "visual": "Visual impairment accommodations",
      "hearing": "Hearing impairment accommodations",
      "sensory": "Sensory-friendly environments",
    };
    const formatted = profilePreferences.accessibilityNeeds
      .map(a => accessLabels[a] || a)
      .join(", ");
    sections.push(`- Accessibility Needs: ${formatted}
  IMPORTANT: All suggested venues MUST be accessible. Avoid locations with stairs, uneven terrain, or limited accessibility.`);
  }

  // Travel styles - influences overall itinerary style
  if (profilePreferences.travelStyles && profilePreferences.travelStyles.length > 0) {
    const styleLabels: Record<string, string> = {
      "adventure": "Adventure-seeker",
      "relaxation": "Relaxation-focused",
      "cultural": "Cultural immersion",
      "foodie": "Food enthusiast",
      "romantic": "Romantic experiences",
      "budget": "Budget-conscious",
      "luxury": "Luxury experiences",
      "solo": "Solo traveler",
      "family": "Family-friendly",
    };
    const formatted = profilePreferences.travelStyles
      .map(s => styleLabels[s] || s)
      .join(", ");
    sections.push(`- Travel Style Preferences: ${formatted}`);
  }

  if (sections.length === 0) return "";

  return `
## Profile Preferences (from user profile)
${sections.join("\n")}
`;
}

/**
 * Build scheduling preferences section for the prompt
 * Uses the user's quiet hours settings to inform activity timing
 * Quiet hours are inverted: if user rests 22:00-08:00, they're active 08:00-22:00
 */
function buildSchedulingPreferencesSection(profilePreferences?: UserProfilePreferences): string {
  if (!profilePreferences) return "";

  const { activeHoursStart, activeHoursEnd } = profilePreferences;

  // Only include if both values are set and reasonable
  if (activeHoursStart === undefined || activeHoursEnd === undefined) return "";
  if (!Number.isInteger(activeHoursStart) || !Number.isInteger(activeHoursEnd)) return "";
  if (activeHoursStart < 0 || activeHoursStart > 23) return "";
  if (activeHoursEnd < 0 || activeHoursEnd > 23) return "";
  // Ensure end is after start with at least a 4-hour window
  if (activeHoursEnd <= activeHoursStart) return "";
  if (activeHoursEnd - activeHoursStart < 4) return "";

  // Format hours nicely (e.g., 8 -> "8:00 AM", 22 -> "10:00 PM")
  const formatHour = (h: number) => {
    const hour12 = h % 12 || 12;
    const ampm = h < 12 ? "AM" : "PM";
    return `${hour12}:00 ${ampm}`;
  };

  const startFormatted = formatHour(activeHoursStart);
  const endFormatted = formatHour(activeHoursEnd);

  return `
## Activity Scheduling Preferences
- User prefers activities between ${startFormatted} and ${endFormatted}
- IMPORTANT: Schedule the first activity of each day no earlier than ${startFormatted}
- IMPORTANT: Ensure all activities end by ${endFormatted} (avoid late-night activities)
- For restaurants: prefer lunch around 12:00-14:00, dinner no later than ${activeHoursEnd - 2}:00
- Allow adequate time for transit between activities
`;
}

interface BuildPromptOptions {
  language?: SupportedLanguage; // Language for AI response
  /**
   * Anchored-trip segment brief (lib/ai/anchors-core.buildSegmentBrief):
   * a deterministic constraint block — fixed commitments, start/end-near
   * context — appended as its own prompt section. Internal only: set by
   * lib/ai/anchored.ts, never by API clients.
   */
  anchorBrief?: string;
  /**
   * Write only days `from`..`to` of the trip, following `outline` for the
   * whole trip (lib/ai/trip-outline.ts). Set by the stream route when a long
   * trip is written in parts at the same time.
   */
  part?: { from: number; to: number; outline: OutlineDay[] };
  /**
   * Places travellers kept for this destination that suit the trip
   * (lib/ai/known-places.ts): the plan is built from them first. A part
   * follows its outline instead, which was given them.
   */
  knownPlaces?: KnownPlace[];
}

/**
 * Get language instruction for AI response
 * Tells Gemini to generate content in the user's preferred language
 */
export function getLanguageInstruction(language?: SupportedLanguage): string {
  if (!language || language === "en") return "";

  const instructions: Record<Exclude<SupportedLanguage, "en">, string> = {
    es: `
## IDIOMA OBLIGATORIO
DEBES responder COMPLETAMENTE en espanol.
- Nombres de actividades: usa el nombre local con traduccion si es util
- Descripciones: escritas naturalmente en espanol
- Consejos (tips): en espanol
- Resumen del viaje: en espanol
- Formato de hora: 24h (ej: 14:00 en lugar de 2:00 PM)
- IMPORTANTE: Mantén la estructura JSON exacta, solo cambia el contenido de texto a espanol`,
    it: `
## LINGUA OBBLIGATORIA
DEVI rispondere COMPLETAMENTE in italiano.
- Nomi delle attivita: usa il nome locale con traduzione se utile
- Descrizioni: scritte naturalmente in italiano
- Consigli (tips): in italiano
- Riepilogo del viaggio: in italiano
- Formato dell'ora: 24h (es: 14:00 invece di 2:00 PM)
- IMPORTANTE: Mantieni la struttura JSON esatta, cambia solo il contenuto testuale in italiano`,
    pt: `
## IDIOMA OBRIGATÓRIO
VOCÊ DEVE responder COMPLETAMENTE em português.
- Nomes das atividades: use o nome local, com tradução quando for útil
- Descrições: escritas naturalmente em português
- Dicas (tips): em português
- Resumo da viagem: em português
- Formato de hora: 24h (ex: 14:00 em vez de 2:00 PM)
- IMPORTANTE: Mantenha a estrutura JSON exata, mude apenas o conteúdo de texto para português`,
  };

  return instructions[language] + "\n\n";
}

// Static output spec, part of the SHARED CHAT PREFIX (see buildStaticChatHistory).
//
// It lives in the static history, not the per-request user prompt, because
// Gemini implicit caching only engages when requests share an identical token
// prefix of >=1024 tokens (2.5 Flash) and the system prompt + ack alone is ~750
// tokens. The blocking and streaming call sites both use
// buildStaticChatHistory, so they share one cache entry.
//
// Everything here MUST stay request-independent. What the server can work out
// itself (booking links, each activity's part of the day) is not asked for:
// every token the model writes is paid for (withServerFields).
const TRIP_OUTPUT_SPEC = `## Required Output

Generate a complete day-by-day itinerary in JSON format with this exact structure:

{
  "destination": {
    "name": "City Name",
    "country": "Country",
    "description": "Brief 1-2 sentence description",
    "best_for": ["type1", "type2"],
    "weather_note": "Expected weather for travel dates"
  },
  "days": [
    {
      "day_number": 1,
      "date": "YYYY-MM-DD",
      "theme": "Day theme (e.g., Historic Center)",
      "activities": [
        {
          "start_time": "09:00",
          "duration_minutes": 120,
          "name": "Real Place Name",
          "type": "attraction",
          "description": "What to do here",
          "location": "Neighborhood name",
          "address": "Full street address",
          "coordinates": {
            "lat": 48.858370,
            "lng": 2.294481
          },
          "official_website": "https://www.example-museum.com",
          "estimated_cost": {
            "amount": 25,
            "currency": "USD",
            "tier": "moderate"
          },
          "tips": ["One helpful tip"],
          "booking_required": true
        }
      ]
    }
  ],
  "trip_summary": {
    "total_estimated_cost": 450,
    "currency": "USD",
    "highlights": ["Highlight 1", "Highlight 2", "Highlight 3"],
    "packing_suggestions": ["Item 1", "Item 2", "Item 3", "Item 4", "Item 5"]
  }
}

Rules:
1. Return ONLY valid JSON, no markdown or extra text
2. All dates must be in YYYY-MM-DD format starting from the trip start date given in the request
3. Match the requested travel pace: the request quantifies it as a target activities-per-day and a daily time budget — keep every day's total scheduled activity time (sum of duration_minutes) within that budget
4. Use REAL place names that exist on Google Maps
5. INCLUDE official_website for major attractions, museums, restaurants, and hotels (they almost always have websites!). Only use null for small local shops/street vendors
6. Activities should flow logically through each day
7. EVERY activity MUST have PRECISE coordinates (lat/lng with 6 decimal places, e.g., 48.858370, 2.294481) - use the EXACT location of each place, not approximate city center. This is critical for accurate map display
8. Write "booking_required": true only on an activity that must be booked ahead; leave the field out on every other activity
9. An activity's "type" says what the place is, and is one of: ${ACTIVITY_TYPES.join(", ")}. Never a travel vibe such as foodie, cultural, urban or romantic
10. Every price, and the trip total, is in US dollars ("currency": "USD") whatever the destination: the app shows prices in the traveller's own currency`;

// Shared chat prefix for BOTH trip-generation call sites (blocking +
// streaming). Byte-identical history across requests is what makes Gemini's
// implicit prefix cache hit; do not interpolate anything request-specific
// here. Dynamic content belongs in buildUserPrompt, with the most volatile
// parts (language header) at the very end.
export function buildStaticChatHistory(systemPrompt: string) {
  return [
    {
      role: "user" as const,
      parts: [{ text: `${systemPrompt}\n\n${TRIP_OUTPUT_SPEC}` }],
    },
    {
      role: "model" as const,
      parts: [
        {
          text: "Understood. I will generate travel itineraries following these rules, returning only valid JSON matching the specified schema.",
        },
      ],
    },
  ];
}

function buildUserPrompt(params: TripCreationParams, options?: BuildPromptOptions): string {
  const totalDuration = tripSpanDays(params.startDate, params.endDate);

  const duration = totalDuration;

  // Build vibe section with weighted influence
  const vibeLabels: Record<TripVibe, string> = {
    adventure: "Adventure Seeker - outdoor activities, hiking, adrenaline",
    cultural: "Cultural Explorer - museums, heritage, local traditions",
    foodie: "Foodie Journey - food markets, local cuisine, restaurants",
    wellness: "Wellness Escape - spa, yoga, peaceful retreats",
    romantic: "Romantic Getaway - intimate experiences, sunset views",
    urban: "Urban Discovery - city life, nightlife, architecture",
    nature: "Nature Immersion - wildlife, parks, wilderness",
    offbeat: "Off the Beaten Path - hidden gems, non-touristy spots",
    wonderland: "Wonderland Adventure - quirky, whimsical, surreal spots",
    "movie-magic": "Movie Magic - film locations, cinematic experiences",
    fairytale: "Fairytale Escape - castles, enchanted forests, storybook villages",
    retro: "Retro Time Travel - vintage cafes, historic districts, nostalgia",
  };

  const vibeSection = params.vibes && params.vibes.length > 0
    ? `## Travel Vibes (${params.vibes.length} selected - PRIORITIZE THESE)
${params.vibes.map((v, i) => {
  const influence = i === 0 ? "50% Primary" : i === 1 ? "30% Secondary" : "20% Accent";
  return `- ${influence}: ${vibeLabels[v] || v}`;
}).join("\n")}

IMPORTANT: Blend these vibes throughout the itinerary. For fantasy vibes (wonderland, movie-magic, fairytale, retro), seek out unusual, photogenic, and story-worthy locations that match that aesthetic.
`
    : "";

  // Backpacker Mode: when the traveller picked it in the wizard, inject a
  // strong directive so Gemini optimises the entire itinerary for the
  // budget / multi-city / social demographic — not just the budget tier.
  // The trips have to *look* like backpacker plans (hostels, walking tours,
  // public transit, social food spots).
  const travelStyleSection = params.travelStyle === "backpacker"
    ? `## Travel Style: BACKPACKER MODE
This traveller is a budget-conscious backpacker. Optimise the itinerary accordingly:

- **Accommodation**: Recommend hostels and budget guesthouses, not hotels. Mention specific neighbourhoods known for hostel density (e.g. Bairro Alto in Lisbon, Khao San in Bangkok). Avoid luxury or boutique accommodation suggestions.
- **Activities**: Favour free walking tours, public museums on free days, viewpoints, markets, beaches, parks. Skip expensive guided tours and curated experiences unless they're a genuine highlight.
- **Food**: Recommend street food, markets, local cafeterias, hostel-kitchen-friendly grocery options. One "splurge" meal at most, ideally local and not touristy.
- **Transit**: Default to walking, public transit, intercity buses (FlixBus, BlaBlaCar). Avoid taxis unless safety / late-night. Mention specific transit cards or passes worth getting.
- **Social**: Include at least one explicitly social-friendly activity per day (pub crawl, walking tour, language exchange, market, hostel-organised event). Backpackers want to meet people.
- **Multi-city friendly**: If the trip is 5+ days, consider whether splitting between 2 cities would serve them better. Mention the transit option if so.
- **Time of day**: Backpackers often arrive late after long bus/train rides; early activities on arrival days should be optional, not core.

The traveller specifically wants the backpacker experience. Do NOT default to mid-range tourist plans.
`
    : "";

  // Build seasonal context section
  const seasonalSection = params.seasonalContext
    ? `## Seasonal Context
- Season: ${params.seasonalContext.season}
- Expected Weather: ${params.seasonalContext.weather}
- Temperature: ${params.seasonalContext.avgTemp.min}°C to ${params.seasonalContext.avgTemp.max}°C
- Crowd Level: ${params.seasonalContext.crowdLevel}
${params.seasonalContext.holidays.length > 0 ? `- Holidays/Events: ${params.seasonalContext.holidays.join(", ")}` : ""}

Consider these seasonal factors when selecting activities and timing. Include seasonal-specific experiences if relevant.
`
    : "";

  // Language instruction for non-English responses
  const languageSection = getLanguageInstruction(options?.language);

  // Anchored-trip constraints: deterministic brief from lib/ai/anchors-core —
  // fixed commitments + where this stretch must start and end. Placed late in
  // the prompt (near the other per-trip values) so the cache-friendly head of
  // the request stays untouched.
  const anchorSection = options?.anchorBrief
    ? `## Fixed Commitments (plan around these — they are non-negotiable)
${options.anchorBrief}

`
    : "";

  const part = options?.part;
  const partSection = part
    ? `## This Request: Days ${part.from}–${part.to} of ${duration}
The trip is written in parts at the same time. Write ONLY days ${part.from} to ${part.to}: the "days" array holds exactly those days, numbered ${part.from} to ${part.to}, dated ${addIsoDays(params.startDate, part.from - 1)} to ${addIsoDays(params.startDate, part.to - 1)}.
${
  part.from === 1
    ? 'Fill "destination" and "trip_summary" for the whole trip.'
    : 'Another part fills the trip-level fields: give "destination" only its name and country, and leave "trip_summary" out.'
}

The whole trip, day by day (theme, area, the places it is built around):
${part.outline.map((d) => `- Day ${d.day_number}: ${d.theme} (${d.area}): ${d.places.join("; ")}`).join("\n")}

Build each of your days around its own places, at the pace asked for above. Never use a place listed for another day.

`
    : "";

  const knownPlaces = part ? [] : (options?.knownPlaces ?? []);
  const knownSection = knownPlaces.length
    ? `
## Places Travellers Kept Here
Travellers on trips like this one kept these places in their plans. Build the days from them first${params.mustDos?.length ? ", after the must-dos" : ""}: use the ones that suit this trip's vibes, budget, pace, season and requirements, each at most once and named exactly as listed, then add other real places to complete the days.
${knownPlaces.map((p) => `- ${p.name} (${p.type})`).join("\n")}
`
    : "";

  // Language header intentionally at the END (see tail of this template):
  // it is the most cache-hostile token span (varies per locale), and the
  // shared-prefix cache only covers the identical head of the request.
  return `Plan a ${duration}-day trip to ${params.destination}.

## Travel Details
- Dates: ${params.startDate} to ${params.endDate}
- Duration: ${duration} days
- Budget Tier: ${params.budgetTier}
- Travel Pace: ${params.pace} — ${paceBudgetPromptClause(params.pace)}

${travelStyleSection}${vibeSection}${seasonalSection}## Traveler Preferences
- Interests: ${params.interests.length > 0 ? params.interests.join(", ") : "general sightseeing"}
${params.requirements ? `- Special Requirements: ${params.requirements}` : ""}
${
  // A part follows the outline, which already put each must-do on one day.
  params.mustDos && params.mustDos.length > 0 && !part
    ? `
## Traveller Must-Dos (explicitly requested — schedule every one)
The traveller listed these by name. Include EACH as an activity on a sensible day (right area of the city, right time slot, realistic duration). Use the real place/dish/experience they named — never substitute a look-alike. If one is genuinely impossible for these dates or this destination, omit it rather than faking it.
${params.mustDos.map((m) => `- ${m}`).join("\n")}
`
    : ""
}${knownSection}${buildProfilePreferencesSection(params.profilePreferences)}${buildSchedulingPreferencesSection(params.profilePreferences)}

${anchorSection}${partSection}Generate the itinerary now, following the system rules and the Required Output schema exactly.${languageSection}`;
}

/**
 * Generation options for controlling output
 */
export interface GenerationOptions extends BuildPromptOptions {
  retryCount?: number;
}

export async function generateItinerary(
  params: TripCreationParams,
  options?: GenerationOptions & { userId?: string }
): Promise<GeneratedItinerary> {
  // Generate deduplication key from request parameters
  const dedupKey = getItineraryDedupKey({
    destination: params.destination,
    startDate: params.startDate,
    endDate: params.endDate,
    budgetTier: params.budgetTier,
    pace: params.pace,
    vibes: params.vibes,
    language: options?.language,
    anchorBrief: options?.anchorBrief,
  });

  // Wrap with deduplication to prevent duplicate concurrent requests
  return withDeduplication(dedupKey, () =>
    generateItineraryInternal(params, options)
  );
}

/**
 * Internal itinerary generation function (without deduplication wrapper)
 */
async function generateItineraryInternal(
  params: TripCreationParams,
  options?: GenerationOptions & { userId?: string }
): Promise<GeneratedItinerary> {
  const retryCount = options?.retryCount ?? 0;
  const MAX_RETRIES = 1;
  const startTime = performance.now();

  // Route through model-router so the routing matrix lives in one place.
  // trip-generation → gemini-2.5-flash.
  const modelName = getModelForPurpose("trip-generation");

  // Thinking is off (thinkingConfig below). gemini-2.5-flash thinks by
  // default: thinking tokens count against maxOutputTokens and, on a full
  // itinerary prompt, can push every attempt past its timeout. Structured JSON
  // output does not need deep reasoning. 2.5-pro rejects thinkingBudget 0
  // ("only works in thinking mode"), so this purpose must stay on a flash model.
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      temperature: retryCount > 0 ? 0.7 : 1.0, // Lower temperature on retry
      topP: 0.95,
      topK: 40,
      // A day costs ~750 output tokens and the wizard's MAX_TRIP_DAYS is 14
      // (~10.5k), so a lower cap cuts the longest trips short. Gemini bills
      // EMITTED output tokens, not the cap, so shorter trips cost the same.
      // Keep in sync with generateItineraryStream (same model, same prompt).
      maxOutputTokens: 16000,
      responseMimeType: "application/json",
      thinkingConfig: thinkingConfigFor(modelName),
    },
  });

  // Fetch system prompt from database (with caching and fallback)
  const systemPrompt = await getPrompt("trip_generation_system");

  // Shared static prefix (system prompt + output spec + ack) — identical
  // bytes across every request and across the streaming variant, so Gemini's
  // implicit prefix cache can engage (requires >=1024 identical tokens).
  const chat = model.startChat({
    history: buildStaticChatHistory(systemPrompt),
  });

  // options carries the response language and the anchored-trip brief.
  const userPrompt = buildUserPrompt(params, options);

  try {
    const result = await withTimeout(
      chat.sendMessage(userPrompt),
      itineraryTimeoutMs(tripSpanDays(params.startDate, params.endDate)),
      "Itinerary generation"
    );
    const response = result.response;
    const text = response.text();
    const latencyMs = performance.now() - startTime;

    // Log cache metrics for monitoring
    logCacheMetrics("generateItinerary", response.usageMetadata, modelName);

    // Try to parse JSON, with a defensive repair pass for truncated output
    // (the model can hit maxOutputTokens mid-string).
    const parseAttempt = (source: string): GeneratedItinerary => {
      const itinerary = JSON.parse(source) as GeneratedItinerary;
      if (!itinerary.destination || !itinerary.days || itinerary.days.length === 0) {
        throw new Error("Invalid itinerary structure");
      }
      return itinerary;
    };

    let itinerary: GeneratedItinerary | null = null;
    let repairUsed = false;
    try {
      itinerary = parseAttempt(text);
    } catch (firstParseError) {
      const repaired = tryRepairTruncatedJSON(text);
      if (repaired) {
        try {
          itinerary = parseAttempt(repaired);
          repairUsed = true;
        } catch {
          /* repair didn't produce valid JSON either — fall through */
        }
      }
      if (!itinerary) {
        // Unrepairable: log, then retry or throw. Only the last attempt is an
        // error; one that is retried is a warning.
        (retryCount < MAX_RETRIES ? console.warn : console.error)(
          `JSON parse error (attempt ${retryCount + 1}):`,
          firstParseError instanceof Error ? firstParseError.message : "Unknown",
          "\nResponse preview:",
          text.substring(0, 500)
        );

        captureLLMGeneration({
          distinctId: options?.userId || "anonymous",
          model: modelName,
          endpoint: "generateItinerary",
          usageMetadata: response.usageMetadata as GeminiUsageMetadata,
          latencyMs,
          success: false,
          error: "JSON parse error",
          properties: {
            destination: params.destination,
            retry_count: retryCount,
          },
        }).catch(() => {});

        // Retry with lower temperature (bypass deduplication for retries)
        if (retryCount < MAX_RETRIES) {
          console.log(`Retrying generation (attempt ${retryCount + 2})...`);
          return generateItineraryInternal(params, { ...options, retryCount: retryCount + 1 });
        }

        throw new Error("Failed to generate valid itinerary after retries");
      }
    }

    // Validate and fix coordinates for all activities
    itinerary.days = validateAndFixCoordinates(itinerary.days, params.destination);
    // Backfill trip_summary when missing (truncated tail) so wizard render
    // + persistTrip don't crash on `.trip_summary.total_estimated_cost`.
    ensureTripSummary(itinerary);
    withServerFields(itinerary, params);
    // In one currency before a multi-city or fixed-plan trip adds its parts up.
    await inPlanCurrency(itinerary);

    // Capture LLM analytics (fire and forget)
    captureLLMGeneration({
      distinctId: options?.userId || "anonymous",
      model: modelName,
      endpoint: "generateItinerary",
      usageMetadata: response.usageMetadata as GeminiUsageMetadata,
      latencyMs,
      success: true,
      properties: {
        destination: params.destination,
        duration_days: itinerary.days.length,
        budget_tier: params.budgetTier,
        pace: params.pace,
        vibes: params.vibes,
        retry_count: retryCount,
        repair_used: repairUsed,
      },
    }).catch(() => {});

    // If we needed to repair, log a breadcrumb (NOT a Sentry issue) so we can
    // still see repair frequency in Sentry tags/breadcrumbs without polluting
    // the issue stream ("warning" severity would surface each one as an issue).
    if (repairUsed) {
      const days = itinerary.days.length;
      const msg =
        `[gemini] tryRepairTruncatedJSON recovered a ${days}-day itinerary ` +
        `for "${params.destination}" (output ${text.length} chars).`;
      console.warn(msg);
      import("@sentry/nextjs")
        .then((Sentry) => {
          Sentry.addBreadcrumb?.({
            category: "gemini.repair",
            message: msg,
            level: "info",
            data: { destination: params.destination, days, output_chars: text.length },
          });
        })
        .catch(() => {});
    }

    return itinerary;
  } catch (error) {
    const latencyMs = performance.now() - startTime;

    // Handle API errors (rate limits, network issues, etc.)
    if (error instanceof Error && error.message.includes("after retries")) {
      throw error;
    }

    console.error("Gemini API error:", error);

    // Capture API error analytics
    captureLLMGeneration({
      distinctId: options?.userId || "anonymous",
      model: modelName,
      endpoint: "generateItinerary",
      latencyMs,
      success: false,
      error: error instanceof Error ? error.message : "Unknown API error",
      properties: {
        destination: params.destination,
        retry_count: retryCount,
      },
    }).catch(() => {});

    if (retryCount < MAX_RETRIES) {
      console.log(`Retrying after API error (attempt ${retryCount + 2})...`);
      await new Promise((resolve) => setTimeout(resolve, 1000 * (retryCount + 1)));
      return generateItineraryInternal(params, { ...options, retryCount: retryCount + 1 });
    }

    // Surface the underlying error so Sentry sees WHY we failed (403
    // key-banned, 429 quota, 503 outage, etc.). Preserve `cause` so the
    // original stack survives.
    const rootMsg =
      error instanceof Error ? error.message : String(error ?? "unknown");
    const wrapped = new Error(
      `Failed to generate itinerary: AI service unavailable (root: ${rootMsg.slice(0, 200)})`
    );
    if (error instanceof Error) {
      (wrapped as Error & { cause?: unknown }).cause = error;
    }
    throw wrapped;
  }
}

/**
 * Regenerate a single activity within an itinerary
 * Used when a user wants to replace one activity with a different suggestion
 */
export interface RegenerateActivityParams {
  destination: string;
  activityToReplace: Activity;
  dayContext: ItineraryDay;
  budgetTier: "budget" | "balanced" | "premium";
  existingActivityNames: string[];
  preferences?: {
    category?: "attraction" | "restaurant" | "activity" | "transport";
    similarTo?: boolean; // If true, generate something similar
  };
  language?: SupportedLanguage;
  /**
   * Trip's travel style — when "backpacker", the replacement is biased
   * toward hostel-friendly / budget / social options, so a hostel is not
   * swapped for, e.g., a boutique hotel. Read from trip_meta.travel_style
   * at the call site. Defaults to "classic".
   */
  travelStyle?: "classic" | "backpacker";
  /** The trip's diets (trip_meta.dietary): a replacement place to eat must suit them. */
  dietary?: string[];
}

// The activity regeneration prompt loads from the database via getPrompt();
// lib/prompts.ts holds the defaults.

export async function regenerateSingleActivity(
  params: RegenerateActivityParams & { userId?: string },
  retryCount = 0
): Promise<Activity> {
  // Generate deduplication key - note: only first call gets deduplicated, retries bypass
  if (retryCount === 0) {
    const dedupKey = getActivityDedupKey({
      destination: params.destination,
      activityName: params.activityToReplace.name,
      timeSlot: params.activityToReplace.time_slot,
      dayNumber: params.dayContext.day_number,
      budgetTier: params.budgetTier,
    });

    return withDeduplication(dedupKey, () =>
      regenerateSingleActivityInternal(params, retryCount)
    );
  }

  // Retries bypass deduplication
  return regenerateSingleActivityInternal(params, retryCount);
}

/**
 * Internal activity regeneration function (without deduplication wrapper)
 */
async function regenerateSingleActivityInternal(
  params: RegenerateActivityParams & { userId?: string },
  retryCount = 0
): Promise<Activity> {
  const MAX_RETRIES = 1;
  const startTime = performance.now();
  // activity-regenerate → gemini-2.5-flash-lite (cheapest, single activity).
  const modelName = getModelForPurpose("activity-regenerate");

  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      // Low temperature: single-activity regenerate is a utility call, and two
      // clicks on the same activity should surface similar shapes. Variety
      // comes from the exclusion list of existing activity names in the prompt.
      temperature: retryCount > 0 ? 0.3 : 0.5,
      topP: 0.95,
      topK: 40,
      maxOutputTokens: 2048,
      responseMimeType: "application/json",
    },
  });

  const userPrompt = replacementPrompt(params);

  // Fetch regeneration prompt from database (with caching and fallback)
  const regenerateSystemPrompt = await getPrompt("activity_regeneration");

  try {
    const result = await withTimeout(
      model.generateContent({
        contents: [
          { role: "user", parts: [{ text: regenerateSystemPrompt }] },
          { role: "model", parts: [{ text: "Understood. I will generate a single replacement activity as valid JSON." }] },
          { role: "user", parts: [{ text: userPrompt }] },
        ],
      }),
      AI_REQUEST_TIMEOUT_MS,
      "Activity regeneration"
    );

    const response = result.response;
    const text = response.text();
    const latencyMs = performance.now() - startTime;

    // Log cache metrics for monitoring
    logCacheMetrics("regenerateSingleActivity", response.usageMetadata, modelName);

    try {
      const activity = asReplacement(JSON.parse(text));

      // Validate required fields
      if (!activity) {
        throw new Error("Invalid activity structure");
      }

      // Capture LLM analytics (fire and forget)
      captureLLMGeneration({
        distinctId: params.userId || "anonymous",
        model: modelName,
        endpoint: "regenerateSingleActivity",
        usageMetadata: response.usageMetadata as GeminiUsageMetadata,
        latencyMs,
        success: true,
        properties: {
          destination: params.destination,
          replaced_activity: params.activityToReplace.name,
          new_activity: activity.name,
          budget_tier: params.budgetTier,
          retry_count: retryCount,
        },
      }).catch(() => {});

      return activity;
    } catch (parseError) {
      (retryCount < MAX_RETRIES ? console.warn : console.error)(
        `Activity regeneration JSON parse error (attempt ${retryCount + 1}):`,
        parseError instanceof Error ? parseError.message : "Unknown",
        "\nResponse preview:",
        text.substring(0, 300)
      );

      // Capture failed attempt analytics
      captureLLMGeneration({
        distinctId: params.userId || "anonymous",
        model: modelName,
        endpoint: "regenerateSingleActivity",
        usageMetadata: response.usageMetadata as GeminiUsageMetadata,
        latencyMs,
        success: false,
        error: "JSON parse error",
        properties: {
          destination: params.destination,
          retry_count: retryCount,
        },
      }).catch(() => {});

      if (retryCount < MAX_RETRIES) {
        console.log(`Retrying activity regeneration (attempt ${retryCount + 2})...`);
        return regenerateSingleActivityInternal(params, retryCount + 1);
      }

      throw new Error("Failed to regenerate activity after retries");
    }
  } catch (error) {
    const latencyMs = performance.now() - startTime;

    if (error instanceof Error && error.message.includes("after retries")) {
      throw error;
    }

    console.error("Gemini API error during activity regeneration:", error);

    // Capture API error analytics
    captureLLMGeneration({
      distinctId: params.userId || "anonymous",
      model: modelName,
      endpoint: "regenerateSingleActivity",
      latencyMs,
      success: false,
      error: error instanceof Error ? error.message : "Unknown API error",
      properties: {
        destination: params.destination,
        retry_count: retryCount,
      },
    }).catch(() => {});

    if (retryCount < MAX_RETRIES) {
      console.log(`Retrying after API error (attempt ${retryCount + 2})...`);
      await new Promise((resolve) => setTimeout(resolve, 1000 * (retryCount + 1)));
      return regenerateSingleActivityInternal(params, retryCount + 1);
    }

    throw new Error("Failed to regenerate activity: AI service unavailable");
  }
}

/** What to ask for in place of an activity; `options` asks for that many, best first, in a JSON array. */
function replacementPrompt(params: RegenerateActivityParams, options?: number): string {
  const { activityToReplace, dayContext, existingActivityNames, preferences } = params;
  // Priced like the rest of the trip.
  const currency = activityToReplace.estimated_cost?.currency || planCurrency([dayContext]);

  const languageInstruction = getLanguageInstruction(params.language);

  return `${languageInstruction}Generate a replacement activity for a trip to ${params.destination}.

## Current Activity to Replace
- Name: ${activityToReplace.name}
- Type: ${activityToReplace.type}
- Time Slot: ${activityToReplace.time_slot}
- Start Time: ${activityToReplace.start_time}
- Duration: ${activityToReplace.duration_minutes} minutes
- Location: ${activityToReplace.location}

## Day Context
- Day Theme: ${dayContext.theme || "General exploration"}
- Date: ${dayContext.date}
- Other activities this day: ${dayContext.activities.filter(a => a.name !== activityToReplace.name).map(a => a.name).join(", ") || "None"}

## Constraints
- Budget Tier: ${params.budgetTier}
- Time Slot: ${activityToReplace.time_slot}
- Start Time: ${activityToReplace.start_time}
- Duration should be approximately: ${activityToReplace.duration_minutes} minutes
${preferences?.category ? `- Category preference: ${preferences.category}` : ""}
${preferences?.similarTo ? "- Should be similar in type/style to the replaced activity" : "- Should be different/fresh compared to the replaced activity"}
${params.travelStyle === "backpacker" ? `- BACKPACKER TRIP: prefer hostels (not hotels), street food / markets / casual eateries, free walking tours, viewpoints, public transit. Avoid expensive guided tours, taxis, and upscale dining. Favour social spots where solo travellers can meet others.` : ""}
${params.dietary?.length ? `- Diet: ${params.dietary.join(", ")}. A place to eat must suit it: a real, long-established place well known for it, not a new or little-known one.` : ""}

## Do NOT suggest any of these places (already in itinerary):
${existingActivityNames.join(", ")}

## Required JSON Output
${options ? `${options} different options, best first, as a JSON array of objects like this one:\n` : ""}{
  "time_slot": "${activityToReplace.time_slot}",
  "start_time": "${activityToReplace.start_time}",
  "duration_minutes": ${activityToReplace.duration_minutes},
  "name": "Real Place Name",
  "type": "${ACTIVITY_TYPES.join("|")}",
  "description": "What to do here (2-3 sentences)",
  "location": "Neighborhood or area name",
  "address": "Full street address",
  "coordinates": {
    "lat": 48.858370,
    "lng": 2.294481
  },
  "official_website": null,
  "estimated_cost": {
    "amount": 0,
    "currency": "${currency}",
    "tier": "free|budget|moderate|expensive"
  },
  "tips": ["Tip 1", "Tip 2"],
  "booking_required": false
}

Return ONLY the JSON ${options ? "array" : "object"}, no extra text.`;
}

/**
 * A replacement as the model wrote it, made an activity: its type one the app
 * knows, an id, and coordinates only when they are a real point. Null when it
 * lacks a name, a type or a time slot.
 */
function asReplacement(raw: unknown): Activity | null {
  const activity = raw as Activity | null;
  if (!activity?.name || !activity.type || !activity.time_slot) return null;
  activity.type = normalizeActivityType(activity.type, activity.name);
  activity.id = generateActivityId();
  if (
    activity.coordinates &&
    typeof activity.coordinates.lat === "number" &&
    typeof activity.coordinates.lng === "number" &&
    (activity.coordinates.lat < -90 || activity.coordinates.lat > 90 ||
     activity.coordinates.lng < -180 || activity.coordinates.lng > 180 ||
     activity.coordinates.lat === 0 && activity.coordinates.lng === 0)
  ) {
    activity.coordinates = undefined as unknown as typeof activity.coordinates;
  }
  return activity;
}

// The rules of the activity_regeneration prompt (lib/prompts.ts), for several options.
const REPLACEMENT_OPTIONS_SYSTEM = `You are MonkeyTravel AI. Suggest replacement activities for a travel itinerary.

## Rules
1. **Real Places Only**: Only suggest real, verifiable locations that exist and are open today. Each must be searchable on Google Maps.
2. **Avoid Duplicates**: Do not suggest any place already in the itinerary, and no place twice.
3. **Context Aware**: Each option should fit the time slot and day theme.
4. **Verifiable**: Include the full street address, and official_website when the place has one.
5. **GPS Coordinates**: Include accurate latitude/longitude. This is MANDATORY.

## Output Format
Return ONLY a valid JSON array of activities. No markdown, no extra text.`;

// The plan waits for the options, so they get less time than a swap the traveller asked for.
const REPLACEMENT_OPTIONS_TIMEOUT_MS = 20_000;

/**
 * A few activities to put in place of one, best first, from one call. The
 * check of a diet plan's places to eat (lib/places/places-to-eat.ts) takes the
 * first that is open and not in the plan yet: asked for one, the model offers a
 * place the plan already has now and then, however it is told not to.
 */
export async function replacementOptions(
  params: RegenerateActivityParams & { userId?: string },
  count = 3
): Promise<Activity[]> {
  const startTime = performance.now();
  const modelName = getModelForPurpose("activity-regenerate");
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: { temperature: 0.7, topP: 0.95, topK: 40, maxOutputTokens: 4096, responseMimeType: "application/json" },
  });
  const result = await withTimeout(
    model.generateContent({
      contents: [
        { role: "user", parts: [{ text: REPLACEMENT_OPTIONS_SYSTEM }] },
        { role: "model", parts: [{ text: "Understood. I will give the options as a valid JSON array." }] },
        { role: "user", parts: [{ text: replacementPrompt(params, count) }] },
      ],
    }),
    REPLACEMENT_OPTIONS_TIMEOUT_MS,
    "Replacement options"
  );
  const response = result.response;
  logCacheMetrics("replacementOptions", response.usageMetadata, modelName);
  const parsed: unknown = JSON.parse(response.text());
  const options = (Array.isArray(parsed) ? parsed : [parsed]).map(asReplacement).filter((a): a is Activity => a !== null);
  captureLLMGeneration({
    distinctId: params.userId || "anonymous",
    model: modelName,
    endpoint: "replacementOptions",
    usageMetadata: response.usageMetadata as GeminiUsageMetadata,
    latencyMs: performance.now() - startTime,
    success: options.length > 0,
    properties: {
      destination: params.destination,
      replaced_activity: params.activityToReplace.name,
      options: options.map((a) => a.name),
    },
  }).catch(() => {});
  return options;
}

/**
 * Regenerate a single day within an existing itinerary.
 *
 * Unlike `generateItinerary` (whole trip) and `regenerateSingleActivity`
 * (one activity), this produces a fresh ItineraryDay that complements the
 * surrounding days — different theme, no duplicate places, same vibe/budget.
 *
 * Pass `dayContext.surroundingDays` so the model can avoid repeating the
 * neighborhoods/places already in the trip. Pass `instructions` to nudge
 * the result (e.g., "make it more relaxed", "focus on food").
 */
export interface RegenerateDayParams {
  destination: string;
  dayNumber: number; // 1-indexed
  date: string; // YYYY-MM-DD — preserved on the output
  budgetTier: "budget" | "balanced" | "premium";
  pace: "relaxed" | "moderate" | "active";
  vibes: string[];
  /** All other days in the trip (for context + dedup). Excludes the day being replaced. */
  surroundingDays: ItineraryDay[];
  /** Optional user-provided steering (e.g., "less walking", "focus on food"). */
  instructions?: string;
  profilePreferences?: UserProfilePreferences;
  language?: SupportedLanguage;
  /**
   * Trip's travel style — pass "backpacker" so the regenerated day
   * matches the rest of the trip (hostels, free activities, social);
   * without it a backpacker trip gets a classic day. Read from
   * trip_meta.travel_style at the call site. Defaults to "classic".
   */
  travelStyle?: "classic" | "backpacker";
}

export async function regenerateSingleDay(
  params: RegenerateDayParams & { userId?: string },
  retryCount = 0
): Promise<ItineraryDay> {
  // Dedup only the first call; retries bypass.
  if (retryCount === 0) {
    const dedupKey = getDayDedupKey({
      destination: params.destination,
      dayNumber: params.dayNumber,
      budgetTier: params.budgetTier,
      instructions: params.instructions,
    });
    return withDeduplication(dedupKey, () =>
      regenerateSingleDayInternal(params, retryCount)
    );
  }
  return regenerateSingleDayInternal(params, retryCount);
}

async function regenerateSingleDayInternal(
  params: RegenerateDayParams & { userId?: string },
  retryCount = 0
): Promise<ItineraryDay> {
  const MAX_RETRIES = 1;
  const startTime = performance.now();
  // day-regenerate → gemini-2.5-flash (balanced quality/cost for a single day).
  // The FINAL retry switches to the sibling model: the SAME model at a LOWER
  // temperature tends to reproduce the same malformed JSON, and a different
  // model also dodges model-specific 5xx outages.
  const modelName =
    retryCount >= MAX_RETRIES
      ? getSiblingModel(getModelForPurpose("day-regenerate"))
      : getModelForPurpose("day-regenerate");

  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      // Low temperature: day-regenerate is a utility call. The surrounding-days
      // context + existing-places exclusion list already push the new day away
      // from the one being replaced, and a low temperature keeps behavior
      // reproducible for debugging / E2E tests.
      temperature: retryCount > 0 ? 0.3 : 0.5,
      topP: 0.95,
      topK: 40,
      maxOutputTokens: 2048, // One day is ~500-800 tokens; this leaves headroom.
      responseMimeType: "application/json",
      // Thinking OFF, as in generateItineraryInternal and generateItineraryStream.
      // 2.5-flash thinks by default and thinking tokens count against
      // maxOutputTokens, so with thinking on the 2048 cap is spent thinking and
      // the visible JSON comes out cut mid-object. The sibling-model retry
      // handles genuinely bad output.
      thinkingConfig: thinkingConfigFor(modelName),
    },
  });

  // Build context strings from surrounding days
  const surroundingContext = params.surroundingDays
    .map(
      (d) =>
        `Day ${d.day_number} (${d.date}) — ${d.theme || "General"}: ${d.activities
          .map((a) => a.name)
          .join(", ")}`
    )
    .join("\n");

  const existingPlaces = Array.from(
    new Set(
      params.surroundingDays.flatMap((d) => d.activities.map((a) => a.name))
    )
  ).join(", ");
  // Priced like the rest of the trip.
  const currency = planCurrency(params.surroundingDays);

  const languageInstruction = getLanguageInstruction(params.language);
  const profileSection = buildProfilePreferencesSection(params.profilePreferences);
  const schedulingSection = buildSchedulingPreferencesSection(
    params.profilePreferences
  );

  const userPrompt = `${languageInstruction}Regenerate Day ${params.dayNumber} of a ${params.surroundingDays.length + 1}-day trip to ${params.destination}.

## What to Replace
- Day number: ${params.dayNumber}
- Date: ${params.date}
- This day will REPLACE the current Day ${params.dayNumber}. The other days remain unchanged.

## Surrounding Days (do NOT change these — only generate Day ${params.dayNumber})
${surroundingContext || "(no other days)"}

## Already-Visited Places (do NOT include any of these)
${existingPlaces || "(none)"}

## Trip Parameters
- Destination: ${params.destination}
- Budget Tier: ${params.budgetTier}
- Pace: ${params.pace}
- Vibes: ${params.vibes.join(", ") || "general"}
${params.travelStyle === "backpacker" ? `\n## BACKPACKER MODE\nThis is a backpacker trip. The replacement day must match the rest of the trip in style:\n- Hostels (not hotels), street food / markets / casual eateries\n- Free walking tours, viewpoints, parks, free museums\n- Public transit, walking, intercity buses (no taxis except safety)\n- At least one explicitly social activity (pub crawl, walking tour, hostel-organised event)\n- Avoid expensive guided tours and upscale dining\n` : ""}${params.instructions ? `\n## User Instructions for this day\n${params.instructions}\n` : ""}${profileSection}${schedulingSection}

## Required JSON Output

Return ONE day object (NOT an array) with this exact shape:

{
  "day_number": ${params.dayNumber},
  "date": "${params.date}",
  "theme": "A theme that complements but DIFFERS from the surrounding days",
  "activities": [
    {
      "time_slot": "morning",
      "start_time": "09:00",
      "duration_minutes": 120,
      "name": "Real Place Name",
      "type": "attraction",
      "description": "What to do here (2-3 sentences)",
      "location": "Neighborhood",
      "address": "Full street address",
      "coordinates": { "lat": 48.858370, "lng": 2.294481 },
      "official_website": "https://...",
      "estimated_cost": { "amount": 25, "currency": "${currency}", "tier": "moderate" },
      "tips": ["One tip"],
      "booking_required": false
    }
  ]
}

Rules:
1. Return ONLY the JSON object for the day. No markdown, no array, no extra text.
2. day_number MUST be exactly ${params.dayNumber}; date MUST be exactly "${params.date}".
3. Match the ${params.pace} pace: ${paceBudgetPromptClause(params.pace)}.
4. Do NOT include any place from the already-visited list.
5. Use PRECISE coordinates (6 decimal places).
6. Each activity's "type" is one of: ${ACTIVITY_TYPES.join(", ")}.`;

  const regenerateDaySystemPrompt = await getPrompt("regenerate_day");

  try {
    const result = await withTimeout(
      model.generateContent({
        contents: [
          { role: "user", parts: [{ text: regenerateDaySystemPrompt }] },
          {
            role: "model",
            parts: [
              {
                text: "Understood. I will return a single day object as valid JSON.",
              },
            ],
          },
          { role: "user", parts: [{ text: userPrompt }] },
        ],
      }),
      AI_REQUEST_TIMEOUT_MS,
      "Day regeneration"
    );

    const response = result.response;
    const text = response.text();
    const latencyMs = performance.now() - startTime;

    logCacheMetrics("regenerateSingleDay", response.usageMetadata, modelName);

    try {
      // Gemini occasionally wraps the day in an array even when asked not to.
      // Be lenient — accept either { day_number, ... } or [{ day_number, ... }].
      const parsed = JSON.parse(text) as ItineraryDay | ItineraryDay[];
      const day = Array.isArray(parsed) ? parsed[0] : parsed;

      if (!day || !day.activities || !Array.isArray(day.activities) || day.activities.length === 0) {
        throw new Error("Invalid day structure: missing activities");
      }

      // Force day_number and date to the requested values so the UI can
      // splice the result back in without checking the model's choice.
      day.day_number = params.dayNumber;
      day.date = params.date;

      // Stamp IDs on each activity so the UI's drag/edit code paths work.
      for (const activity of day.activities) {
        if (!activity.id) {
          activity.id = generateActivityId();
        }
      }

      // Reuse the trip-wide coordinate fixer for any missing lat/lng.
      const fixed = validateAndFixCoordinates([day], params.destination)[0];

      captureLLMGeneration({
        distinctId: params.userId || "anonymous",
        model: modelName,
        endpoint: "regenerateSingleDay",
        usageMetadata: response.usageMetadata as GeminiUsageMetadata,
        latencyMs,
        success: true,
        properties: {
          destination: params.destination,
          day_number: params.dayNumber,
          activities_count: fixed.activities.length,
          budget_tier: params.budgetTier,
          retry_count: retryCount,
        },
      }).catch(() => {});

      return fixed;
    } catch (parseError) {
      (retryCount < MAX_RETRIES ? console.warn : console.error)(
        `Day regeneration JSON parse error (attempt ${retryCount + 1}):`,
        parseError instanceof Error ? parseError.message : "Unknown",
        // MAX_TOKENS here means the output cap was hit (e.g. spent on
        // thinking). Logged so a truncation is diagnosable from the logs
        // instead of inferred from the preview.
        "\nfinishReason:",
        response.candidates?.[0]?.finishReason ?? "unknown",
        "\nResponse preview:",
        text.substring(0, 500)
      );

      captureLLMGeneration({
        distinctId: params.userId || "anonymous",
        model: modelName,
        endpoint: "regenerateSingleDay",
        usageMetadata: response.usageMetadata as GeminiUsageMetadata,
        latencyMs,
        success: false,
        error: "JSON parse error",
        properties: {
          destination: params.destination,
          day_number: params.dayNumber,
          retry_count: retryCount,
        },
      }).catch(() => {});

      if (retryCount < MAX_RETRIES) {
        console.log(`Retrying day regeneration (attempt ${retryCount + 2})...`);
        return regenerateSingleDayInternal(params, retryCount + 1);
      }
      throw new Error("Failed to regenerate day after retries");
    }
  } catch (error) {
    const latencyMs = performance.now() - startTime;

    if (error instanceof Error && error.message.includes("after retries")) {
      throw error;
    }

    console.error("Gemini API error during day regeneration:", error);

    captureLLMGeneration({
      distinctId: params.userId || "anonymous",
      model: modelName,
      endpoint: "regenerateSingleDay",
      latencyMs,
      success: false,
      error: error instanceof Error ? error.message : "Unknown API error",
      properties: {
        destination: params.destination,
        day_number: params.dayNumber,
        retry_count: retryCount,
      },
    }).catch(() => {});

    if (retryCount < MAX_RETRIES) {
      console.log(`Retrying after API error (attempt ${retryCount + 2})...`);
      await new Promise((resolve) => setTimeout(resolve, 1000 * (retryCount + 1)));
      return regenerateSingleDayInternal(params, retryCount + 1);
    }
    throw new Error("Failed to regenerate day: AI service unavailable");
  }
}

// ============================================================================
// STREAMING ITINERARY GENERATION
// ============================================================================

/**
 * Yield type for `generateItineraryStream`. Each chunk carries the
 * incremental text Gemini emitted since the last yield. The terminal
 * yield is signalled by `done=true` and includes the fully-accumulated
 * text plus usage metadata.
 */
export interface StreamChunk {
  text: string; // incremental delta this chunk
  done: false;
}

export interface StreamFinal {
  text: ""; // empty delta — fullText is the canonical accumulation
  done: true;
  fullText: string;
  latencyMs: number;
  usageMetadata?: GeminiUsageMetadata;
}

export type StreamYield = StreamChunk | StreamFinal;

/**
 * Streaming counterpart to `generateItinerary`. Returns an async
 * generator that yields each partial-response chunk from Gemini, then
 * a terminal {done:true, fullText} payload.
 *
 * Caller responsibilities:
 *   - Maintain a streaming parser (see lib/streaming/day-parser.ts) to
 *     extract complete day objects from the running text
 *   - On terminal yield, do a full JSON.parse(fullText) to get the
 *     canonical GeneratedItinerary (use for cache writes, sanitization,
 *     image fetching)
 *   - Emit SSE events as days arrive (see lib/streaming/sse.ts)
 *
 * Differences from `generateItinerary`:
 *   - No retry-on-parse-failure loop. Streaming + retry would require
 *     replaying earlier chunks to the client, which we don't want. If
 *     the final parse fails, caller emits an SSE error.
 *   - No coordinate-fix pass — caller runs it on the parsed result.
 *   - No deduplication wrapper — concurrent streams to the same dest
 *     are rare (cache layer handles popular dests) and dedup would
 *     require fan-out, which is complex.
 *
 * Throws on Gemini API errors before the first chunk. Errors during
 * streaming surface as a rejected `next()` call — caller should
 * try/catch the `for await` block.
 */
export async function* generateItineraryStream(
  params: TripCreationParams,
  options?: GenerationOptions & { userId?: string }
): AsyncGenerator<StreamYield, void, unknown> {
  const startTime = performance.now();
  // Streaming trip generation → same purpose as the non-streaming path.
  const modelName = getModelForPurpose("trip-generation");
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      temperature: 1.0,
      topP: 0.95,
      topK: 40,
      // A day costs ~750 output tokens and the wizard's MAX_TRIP_DAYS is 14
      // (~10.5k), so a lower cap cuts the longest trips short. Gemini bills
      // EMITTED output tokens, not the cap, so shorter trips cost the same.
      // Keep in sync with generateItineraryInternal (same model, same prompt).
      maxOutputTokens: 16000,
      responseMimeType: "application/json",
      // Thinking OFF, as in generateItineraryInternal. gemini-2.5-flash thinks
      // by default and thinking tokens count against `maxOutputTokens`, so any
      // thinking budget can push the answer past the cap: the SSE stream then
      // emits a valid prefix of an invalid JSON ("Unterminated string" in
      // parseStreamedItinerary).
      thinkingConfig: thinkingConfigFor(modelName),
    },
  });

  const systemPrompt = await getPrompt("trip_generation_system");
  // Same shared static prefix as the blocking call site — one cache entry
  // serves both paths.
  const chat = model.startChat({
    history: buildStaticChatHistory(systemPrompt),
  });

  const userPrompt = buildUserPrompt(params, options);

  // sendMessageStream returns { stream: AsyncIterable, response: Promise }
  // The `stream` iterates partial responses; `response` resolves to the
  // final aggregated response after the stream completes.
  const result = await chat.sendMessageStream(userPrompt);

  try {
    for await (const partial of result.stream) {
      // Each partial may yield zero text if it's a control message
      // (e.g. safety scores updated). Defensive: only yield when
      // there's actual text.
      const delta = partial.text();
      if (delta) {
        yield { text: delta, done: false };
      }
    }
  } catch (err) {
    // Async-iter rejections are silently dropped by `for await` in some
    // engines; explicit rethrow keeps the caller's try/catch effective.
    throw err instanceof Error ? err : new Error(String(err));
  }

  // Aggregate final response. CRITICAL: the canonical text is
  // finalResponse.text(), NOT the deltas joined together.
  // The async-iter `for await` can silently drop chunks under back-
  // pressure, while the final aggregate is complete. Use it as truth.
  const finalResponse = await result.response;
  const canonicalText = finalResponse.text();
  const latencyMs = performance.now() - startTime;
  logCacheMetrics("generateItineraryStream", finalResponse.usageMetadata, modelName);

  // Fire-and-forget LLM analytics — same shape as generateItinerary.
  captureLLMGeneration({
    distinctId: options?.userId || "anonymous",
    model: modelName,
    endpoint: "generateItineraryStream",
    usageMetadata: finalResponse.usageMetadata as GeminiUsageMetadata,
    latencyMs,
    success: true,
    properties: {
      destination: params.destination,
      budget_tier: params.budgetTier,
      pace: params.pace,
      vibes: params.vibes,
    },
  }).catch(() => {});

  yield {
    text: "",
    done: true,
    fullText: canonicalText,
    latencyMs,
    usageMetadata: finalResponse.usageMetadata as GeminiUsageMetadata,
  };
}

/**
 * Validate the streamed itinerary JSON and apply the post-processing
 * the non-streaming path does (coordinate fixing). Returns the cleaned
 * GeneratedItinerary or throws on parse/validation failure.
 */
export function parseStreamedItinerary(
  fullText: string,
  params: TripCreationParams
): GeneratedItinerary {
  // Mirror the repair-on-truncation behaviour from generateItineraryInternal.
  const validate = (obj: GeneratedItinerary): GeneratedItinerary => {
    if (!obj.destination || !obj.days || obj.days.length === 0) {
      throw new Error("Invalid itinerary structure");
    }
    obj.days = validateAndFixCoordinates(obj.days, params.destination);
    ensureTripSummary(obj);
    return withServerFields(obj, params);
  };
  try {
    return validate(JSON.parse(fullText) as GeneratedItinerary);
  } catch (e) {
    const repaired = tryRepairTruncatedJSON(fullText);
    if (repaired) {
      try {
        const obj = validate(JSON.parse(repaired) as GeneratedItinerary);
        const msg =
          `[gemini.streamed] tryRepairTruncatedJSON recovered a ${obj.days.length}-day ` +
          `itinerary for "${params.destination}" (stream ${fullText.length} chars).`;
        console.warn(msg);
        // Breadcrumb only — captureMessage(warning) creates noisy Sentry
        // issues. We want the signal in attached events but not as
        // standalone issues.
        import("@sentry/nextjs")
          .then((Sentry) => {
            Sentry.addBreadcrumb?.({
              category: "gemini.streamed.repair",
              message: msg,
              level: "info",
              data: { destination: params.destination, days: obj.days.length, stream_chars: fullText.length },
            });
          })
          .catch(() => {});
        return obj;
      } catch {
        /* fall through to original error */
      }
    }
    throw e;
  }
}
