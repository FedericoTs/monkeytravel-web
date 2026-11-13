import type { TripCreationParams, TripVibe, UserProfilePreferences } from "@/types";
import type { SupportedLanguage } from "@/lib/ai/language";
import type { OutlineDay } from "@/lib/ai/trip-outline";
import type { KnownPlace } from "@/lib/ai/known-places";
import { paceBudgetPromptClause } from "@/lib/trip/pace";
import { ACTIVITY_TYPES } from "@/lib/trip/activity-type";
import { addIsoDays, tripSpanDays } from "@/lib/dates/iso-date";
import type { ChosenTripIntent } from "@/lib/wizard/answers";

/**
 * The prompt a trip is generated with: the shared chat prefix every
 * generation sends (buildStaticChatHistory), the request's own prompt
 * (buildUserPrompt), and the profile, scheduling and language sections they
 * and the day and activity regenerations include.
 */

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
DEBES responder COMPLETAMENTE en español, con la ortografía correcta: tildes y ñ incluidas.
- Nombres de actividades: usa el nombre local con traducción si es útil
- Descripciones: escritas naturalmente en español
- Consejos (tips): en español
- Resumen del viaje: en español
- Formato de hora: 24h (ej: 14:00 en lugar de 2:00 PM)
- IMPORTANTE: Mantén la estructura JSON exacta, solo cambia el contenido de texto a español`,
    it: `
## LINGUA OBBLIGATORIA
DEVI rispondere COMPLETAMENTE in italiano, con l'ortografia corretta, accenti inclusi.
- Nomi delle attività: usa il nome locale con traduzione se utile
- Descrizioni: scritte naturalmente in italiano
- Consigli (tips): in italiano
- Riepilogo del viaggio: in italiano
- Formato dell'ora: 24h (es: 14:00 invece di 2:00 PM)
- IMPORTANTE: Mantieni la struttura JSON esatta, cambia solo il contenuto testuale in italiano`,
    pt: `
## IDIOMA OBRIGATÓRIO
VOCÊ DEVE responder COMPLETAMENTE em português, com a ortografia correta, acentos incluídos.
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
          "description": "What to do here and why it is worth it, in about 25 words",
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
10. Every price, and the trip total, is in US dollars ("currency": "USD") whatever the destination: the app shows prices in the traveller's own currency
11. Every full day has lunch, and dinner in the evening, at real named places. They count among the day's activities
12. Place every sight, museum, church and market on a day and at a time it is open, using the weekday the request gives for each day: many museums close one day a week (often Monday), churches and cathedrals limit visits around services, and markets often trade only in the morning. Start a stop no earlier than the place opens`;

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

/** Who's coming, from step 1. Only ever these fixed words, never the request's text. */
const TRAVELLERS: Record<ChosenTripIntent, string> = {
  solo: "one person travelling alone. Favour places that suit one: counter seats and casual spots over long set menus, group walking tours, lively central areas in the evening. Never assume a partner or a group. Show this in what you choose, and mention it only where it helps.",
  couple: "two people travelling together. Favour places that suit two: tables for two, walks and views, evenings out. Don't assume it's a romantic trip unless the vibes say so. Show this in what you choose, and mention it only where it helps.",
  family: "a family with children. Favour what children enjoy: parks, hands-on museums, casual restaurants, shorter days with a rest after lunch, short distances between stops. Use any ages under Special Requirements. Don't plan bars or late nights as stops. Show this in what you choose, and mention it only where it helps.",
  group: "friends travelling together. Favour places that suit a group: tables for several, shared dishes, activities that are fun together. Say when a group should book ahead. Show this in what you choose, and mention it only where it helps.",
};

function travellersLine({ tripIntent }: Pick<TripCreationParams, "tripIntent">): string {
  return tripIntent ? `Travellers: ${TRAVELLERS[tripIntent]}` : "";
}

function daylightLine({ daylight }: Pick<TripCreationParams, "daylight">): string {
  if (!daylight) return "";
  const { first, last } = daylight;
  if (first.polar === "day") return "Daylight: the sun doesn't set on these dates.";
  if (first.polar === "night") return "Daylight: the sun doesn't rise on these dates.";
  const span = (a: string | null, b: string | null) => (b && b !== a ? `${a} to ${b}` : a);
  return `Daylight (local time): sunrise about ${span(first.sunrise, last.sunrise)}, sunset about ${span(first.sunset, last.sunset)}. A stop named for the sunrise or the sunset must be under way at that time; otherwise don't name it after one.`;
}

/** Where they're staying, so each day starts near it and ends a short ride from it. */
function stayLine({ stay }: Pick<TripCreationParams, "stay">): string {
  if (!stay) return "";
  const at = stay.coordinates ? ` (${stay.coordinates.lat.toFixed(4)}, ${stay.coordinates.lng.toFixed(4)})` : "";
  return `Staying at: ${stay.name}${at}. Start each day near it and end each day a short ride from it: each day's first and last stops are close to it. The stay itself is never a stop.`;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Each day's weekday, so a place shut on one day of the week stays off that day. */
function daysLine(startDate: string, duration: number): string {
  const days: string[] = [];
  for (let i = 0; i < duration; i++) {
    const date = addIsoDays(startDate, i);
    if (!date) return "";
    days.push(`Day ${i + 1} ${WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]} ${date}`);
  }
  return days.length ? `Days: ${days.join(", ")}` : "";
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

  const travellers = travellersLine(params);
  const daylight = daylightLine(params);
  const stay = stayLine(params);
  const days = daysLine(params.startDate, duration);
  // One city of a trip through several (lib/ai/multi-city): the must-dos are the
  // whole trip's, and the other cities have their own days.
  const otherCities = (params.destinations ?? [])
    .map((d) => d.city.trim())
    .filter((c) => c && c.toLowerCase() !== params.destination.trim().toLowerCase());
  const others = otherCities.length > 1 ? `${otherCities.slice(0, -1).join(", ")} and ${otherCities.at(-1)}` : otherCities[0];
  const mustDosSection = !params.mustDos?.length
    ? ""
    : others
      ? `
## Traveller Must-Dos (for the whole trip)
This plan covers ${params.destination}, one city of a trip that also visits ${others}, which ${otherCities.length > 1 ? "get their" : "gets its"} own days. The traveller listed these by name for the whole trip: include each one that is in or near ${params.destination} as an activity on a sensible day (right area, right time slot, realistic duration), using the real place/dish/experience they named (a misspelled or partial name means the most likely real place). Leave out the ones in or near ${others}: never put a place of ${others} on a day here.
${params.mustDos.map((m) => `- ${m}`).join("\n")}
`
      : `
## Traveller Must-Dos (explicitly requested — schedule every one)
The traveller listed these by name. Include EACH as an activity on a sensible day (right area of the city, right time slot, realistic duration). Use the real place/dish/experience they named (a misspelled or partial name means the most likely real place) — never substitute a look-alike. If one is genuinely impossible for these dates or this destination, omit it rather than faking it.
${params.mustDos.map((m) => `- ${m}`).join("\n")}
`;

  // Language header intentionally at the END (see tail of this template):
  // it is the most cache-hostile token span (varies per locale), and the
  // shared-prefix cache only covers the identical head of the request.
  return `Plan a ${duration}-day trip to ${params.destination}.

## Travel Details
- Dates: ${params.startDate} to ${params.endDate}
${days ? `- ${days}\n` : ""}- Duration: ${duration} days
- Budget Tier: ${params.budgetTier}
- Travel Pace: ${params.pace} — ${paceBudgetPromptClause(params.pace)}
${travellers ? `- ${travellers}\n` : ""}${daylight ? `- ${daylight}\n` : ""}${stay ? `- ${stay}\n` : ""}
${travelStyleSection}${vibeSection}${seasonalSection}## Traveler Preferences
- Interests: ${params.interests.length > 0 ? params.interests.join(", ") : "general sightseeing"}
${params.requirements ? `- Special Requirements: ${params.requirements}` : ""}
${
  // A part follows the outline, which already put each must-do on one day.
  part ? "" : mustDosSection
}${knownSection}${buildProfilePreferencesSection(params.profilePreferences)}${buildSchedulingPreferencesSection(params.profilePreferences)}

${anchorSection}${partSection}Generate the itinerary now, following the system rules and the Required Output schema exactly.${languageSection}`;
}

export { buildProfilePreferencesSection, buildSchedulingPreferencesSection, buildUserPrompt, daylightLine, stayLine, travellersLine };
export type { BuildPromptOptions };
