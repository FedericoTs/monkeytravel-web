import { NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { cookies } from "next/headers";
import {
  classifyTask,
  selectModel,
  estimateCost,
} from "@/lib/ai/config";
import { recordUsage } from "@/lib/ai/usage";
import { checkUsageLimit, incrementUsage } from "@/lib/usage-limits";
import { checkApiAccess, logApiCall } from "@/lib/api-gateway";
import { checkEarlyAccess, incrementEarlyAccessUsage } from "@/lib/early-access";
import { findMatchingActivity, populateActivityBank, isActivityBankPopulated, saveToActivityBank } from "@/lib/activity-bank";
import type {
  ItineraryDay,
  Activity,
  AssistantCard,
  StructuredAssistantResponse,
} from "@/types";
import { generateActivityId } from "@/lib/utils/activity-id";
import {
  generateNearbyCoordinates,
  calculateCentroid,
  type Coordinates,
} from "@/lib/utils/geo";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { formatMinutesToTime } from "@/lib/datetime/format";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || "");

type SupportedLanguage = "en" | "es" | "it";

/**
 * Get the user's preferred language from cookies or profile
 */
async function getUserLanguage(
  supabase: SupabaseClient,
  userId: string
): Promise<SupportedLanguage> {
  const cookieStore = await cookies();
  const localeCookie = cookieStore.get("NEXT_LOCALE");
  if (localeCookie?.value && ["en", "es", "it"].includes(localeCookie.value)) {
    return localeCookie.value as SupportedLanguage;
  }

  try {
    const { data: profile } = await supabase
      .from("users")
      .select("preferred_language")
      .eq("id", userId)
      .single();

    if (profile?.preferred_language && ["en", "es", "it"].includes(profile.preferred_language)) {
      return profile.preferred_language as SupportedLanguage;
    }
  } catch {
    // Ignore errors
  }

  return "en";
}

/**
 * Get language instruction for AI prompts
 */
function getLanguageInstruction(language: SupportedLanguage): string {
  if (language === "en") return "";

  const instructions: Record<"es" | "it", string> = {
    es: `\n\nIMPORTANTE: Responde COMPLETAMENTE en espanol. Los nombres de actividades, descripciones, consejos y el resumen deben estar en espanol.`,
    it: `\n\nIMPORTANTE: Rispondi COMPLETAMENTE in italiano. I nomi delle attivita, le descrizioni, i consigli e il riepilogo devono essere in italiano.`,
  };

  return instructions[language];
}

// Types for the assistant
interface AssistantMessage {
  role: "user" | "assistant";
  content: string;
  cards?: AssistantCard[];
  action?: {
    type: string;
    applied: boolean;
    activityId?: string;
    dayNumber?: number;
  };
  timestamp: string;
}

interface AssistantRequest {
  tripId: string;
  message: string;
  conversationId?: string;
  itinerary?: ItineraryDay[]; // Current itinerary for modifications
  previewMode?: boolean; // If true, return pending changes instead of auto-applying
}

interface TripContext {
  id: string;
  title: string;
  destination: string;
  startDate: string;
  endDate: string;
  budget?: { total: number; currency: string };
  itinerary: ItineraryDay[];
  dayCount: number;
  activityCount: number;
}

// Parse duration from text (returns minutes)
function parseDuration(text: string): number | null {
  const lowerText = text.toLowerCase();

  // Match patterns like "2 hours", "90 minutes", "1.5 hours", "1h30m"
  const hourMatch = lowerText.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)/);
  const minuteMatch = lowerText.match(/(\d+)\s*(?:minutes?|mins?|m)/);
  const hourMinMatch = lowerText.match(/(\d+)\s*h\s*(\d+)\s*m/);

  if (hourMinMatch) {
    return parseInt(hourMinMatch[1]) * 60 + parseInt(hourMinMatch[2]);
  }

  let totalMinutes = 0;
  if (hourMatch) {
    totalMinutes += parseFloat(hourMatch[1]) * 60;
  }
  if (minuteMatch && !hourMatch) {
    totalMinutes += parseInt(minuteMatch[1]);
  } else if (minuteMatch && hourMatch) {
    totalMinutes += parseInt(minuteMatch[1]);
  }

  return totalMinutes > 0 ? Math.round(totalMinutes) : null;
}

// Detect if user wants to replace/add an activity
function detectActionIntent(message: string): {
  type: "replace" | "add" | "remove" | "adjust_duration" | "reorder" | "none";
  activityName?: string;
  dayNumber?: number;
  preference?: string;
  newDuration?: number; // in minutes
  targetTimeSlot?: "morning" | "afternoon" | "evening";
} {
  const lowerMsg = message.toLowerCase();

  // Duration adjustment patterns - check first as they're specific
  const durationPatterns = [
    /(?:make|change|set|adjust)\s+(?:the\s+)?["']?([^"']+?)["']?\s+(?:to\s+)?(\d+(?:\.\d+)?\s*(?:hours?|hrs?|h|minutes?|mins?|m))/i,
    /(?:extend|lengthen)\s+(?:the\s+)?["']?([^"']+?)["']?\s+(?:to\s+)?(\d+(?:\.\d+)?\s*(?:hours?|hrs?|h|minutes?|mins?|m))?/i,
    /(?:shorten|reduce)\s+(?:the\s+)?["']?([^"']+?)["']?\s+(?:to\s+)?(\d+(?:\.\d+)?\s*(?:hours?|hrs?|h|minutes?|mins?|m))?/i,
    /["']?([^"']+?)["']?\s+(?:should\s+be|needs?\s+to\s+be)\s+(\d+(?:\.\d+)?\s*(?:hours?|hrs?|h|minutes?|mins?|m))/i,
    /(?:change|set|adjust)\s+(?:the\s+)?duration\s+(?:of\s+)?["']?([^"']+?)["']?\s+(?:to\s+)?(\d+(?:\.\d+)?\s*(?:hours?|hrs?|h|minutes?|mins?|m))/i,
    /(?:spend|allocate)\s+(\d+(?:\.\d+)?\s*(?:hours?|hrs?|h|minutes?|mins?|m))\s+(?:at|for|on)\s+(?:the\s+)?["']?([^"']+?)["']?/i,
  ];

  for (const pattern of durationPatterns) {
    const match = message.match(pattern);
    if (match) {
      // Handle different capture group orders
      let activityName: string;
      let durationText: string;

      if (pattern.source.startsWith("(?:spend|allocate)")) {
        durationText = match[1];
        activityName = match[2];
      } else {
        activityName = match[1];
        durationText = match[2] || "";
      }

      const duration = parseDuration(durationText || message);

      // For extend/shorten without specific duration, we'll handle it differently
      if (lowerMsg.includes("extend") || lowerMsg.includes("lengthen")) {
        console.log(`[AI Assistant] Detected EXTEND duration for: "${activityName}"`);
        return {
          type: "adjust_duration",
          activityName: activityName.trim(),
          newDuration: duration || -1, // -1 means "extend by default amount"
          preference: "extend",
        };
      }
      if (lowerMsg.includes("shorten") || lowerMsg.includes("reduce")) {
        console.log(`[AI Assistant] Detected SHORTEN duration for: "${activityName}"`);
        return {
          type: "adjust_duration",
          activityName: activityName.trim(),
          newDuration: duration || -2, // -2 means "shorten by default amount"
          preference: "shorten",
        };
      }

      if (duration) {
        console.log(`[AI Assistant] Detected ADJUST_DURATION for: "${activityName}" to ${duration} minutes`);
        return {
          type: "adjust_duration",
          activityName: activityName.trim(),
          newDuration: duration,
        };
      }
    }
  }

  // Reorder/Optimize patterns
  const reorderPatterns = [
    /(?:optimize|reorganize|reorder)\s+(?:my\s+)?(?:day\s+)?(\d+)?(?:\s+schedule)?/i,
    /(?:minimize|reduce)\s+(?:travel|walking|transit)\s+time/i,
    /(?:rearrange|shuffle|resequence)\s+(?:the\s+)?activities/i,
    /(?:make|create)\s+(?:a\s+)?(?:more\s+)?efficient\s+(?:schedule|route|order)/i,
    /(?:move|shift)\s+(?:the\s+)?["']?([^"']+?)["']?\s+to\s+(?:the\s+)?(morning|afternoon|evening)/i,
    /(?:better|optimal|efficient)\s+(?:order|sequence|route)/i,
  ];

  for (const pattern of reorderPatterns) {
    const match = message.match(pattern);
    if (match) {
      // Check if it's a "move X to morning/afternoon/evening" request
      if (pattern.source.includes("move|shift")) {
        console.log(`[AI Assistant] Detected MOVE activity: "${match[1]}" to ${match[2]}`);
        return {
          type: "reorder",
          activityName: match[1]?.trim(),
          targetTimeSlot: match[2]?.toLowerCase() as "morning" | "afternoon" | "evening",
          dayNumber: undefined,
          preference: message,
        };
      }

      const dayNum = match[1] ? parseInt(match[1]) : undefined;
      console.log(`[AI Assistant] Detected REORDER/OPTIMIZE for day: ${dayNum || "all"}`);
      return {
        type: "reorder",
        dayNumber: dayNum,
        preference: message,
      };
    }
  }

  // Replace patterns - more flexible matching
  const replacePatterns = [
    /replace\s+(?:the\s+)?["']?([^"']+?)["']?\s+(?:with|by|for)\s+/i,
    /swap\s+(?:out\s+)?(?:the\s+)?["']?([^"']+?)["']?\s+(?:with|for)\s+/i,
    /change\s+(?:the\s+)?["']?([^"']+?)["']?\s+(?:to|with)\s+/i,
    /instead\s+of\s+(?:the\s+)?["']?([^"']+?)["']?/i,
    /(?:i\s+)?don['']?t\s+(?:want|like)\s+(?:the\s+)?["']?([^"']+?)["']?/i,
    /(?:can\s+you\s+)?replace\s+(?:the\s+)?["']?([^"']+?)["']?$/i,
    /(?:can\s+you\s+)?replace\s+(?:the\s+)?["']?([^"']+?)["']?\s+(?:with|to|for|by)/i,
    /switch\s+(?:the\s+)?["']?([^"']+?)["']?\s+(?:to|with|for)\s+/i,
    /(?:let['']?s\s+)?(?:do\s+)?something\s+(?:else\s+)?instead\s+of\s+(?:the\s+)?["']?([^"']+?)["']?/i,
  ];

  for (const pattern of replacePatterns) {
    const match = message.match(pattern);
    if (match) {
      const activityName = match[1].trim();
      console.log(`[AI Assistant] Detected REPLACE intent for activity: "${activityName}"`);
      return {
        type: "replace",
        activityName,
        preference: message,
      };
    }
  }

  // Add patterns
  const addPatterns = [
    /add\s+(?:a\s+)?(?:new\s+)?(.+?)\s+(?:to|on|for)\s+day\s+(\d+)/i,
    /include\s+(?:a\s+)?(.+?)\s+(?:on|for)\s+day\s+(\d+)/i,
    /add\s+(?:a\s+)?(.+?)\s+(?:for\s+)?(?:lunch|dinner|breakfast|morning|afternoon|evening)/i,
    /suggest\s+(?:a\s+)?(.+?)\s+(?:to\s+add|for)/i,
    /recommend\s+(?:a\s+)?(.+?)\s+(?:to\s+add|for)/i,
  ];

  for (const pattern of addPatterns) {
    const match = message.match(pattern);
    if (match) {
      return {
        type: "add",
        preference: match[1].trim(),
        dayNumber: match[2] ? parseInt(match[2]) : undefined,
      };
    }
  }

  // Simple add detection
  if (
    lowerMsg.includes("add ") ||
    lowerMsg.includes("suggest a ") ||
    lowerMsg.includes("recommend a ")
  ) {
    return { type: "add", preference: message };
  }

  // Remove patterns
  if (
    lowerMsg.includes("remove ") ||
    lowerMsg.includes("delete ") ||
    lowerMsg.includes("take out ")
  ) {
    return { type: "remove", preference: message };
  }

  return { type: "none" };
}

// Find activity by name (improved fuzzy match)
function findActivityByName(
  itinerary: ItineraryDay[],
  searchName: string
): { activity: Activity; dayIndex: number; activityIndex: number } | null {
  const lowerSearch = searchName.toLowerCase().trim();

  // Remove common words that might interfere with matching
  const cleanSearch = lowerSearch
    .replace(/^(the|a|an|visit|go to|see|explore)\s+/i, "")
    .replace(/\s+(visit|tour|experience|activity)$/i, "")
    .trim();

  console.log(`[AI Assistant] Searching for activity: "${searchName}" (cleaned: "${cleanSearch}")`);
  console.log(`[AI Assistant] Activities in itinerary:`);

  let bestMatch: { activity: Activity; dayIndex: number; activityIndex: number; score: number } | null = null;

  for (let dayIdx = 0; dayIdx < itinerary.length; dayIdx++) {
    const day = itinerary[dayIdx];
    for (let actIdx = 0; actIdx < day.activities.length; actIdx++) {
      const activity = day.activities[actIdx];
      const activityName = activity.name.toLowerCase();
      const cleanActivityName = activityName
        .replace(/^(the|a|an|visit|go to|see|explore)\s+/i, "")
        .replace(/\s+(visit|tour|experience|activity)$/i, "")
        .trim();

      console.log(`  - Day ${dayIdx + 1}: "${activity.name}"`);

      let score = 0;

      // Exact match (highest priority)
      if (activityName === lowerSearch || cleanActivityName === cleanSearch) {
        score = 100;
      }
      // Activity name contains search term
      else if (activityName.includes(lowerSearch) || cleanActivityName.includes(cleanSearch)) {
        score = 80;
      }
      // Search term contains activity name
      else if (lowerSearch.includes(activityName) || cleanSearch.includes(cleanActivityName)) {
        score = 70;
      }
      // Word-by-word matching
      else {
        const searchWords = cleanSearch.split(/\s+/);
        const activityWords = cleanActivityName.split(/\s+/);
        const matchedWords = searchWords.filter(sw =>
          activityWords.some(aw => aw.includes(sw) || sw.includes(aw))
        );
        if (matchedWords.length > 0) {
          score = (matchedWords.length / searchWords.length) * 60;
        }
      }

      if (score > 0 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { activity, dayIndex: dayIdx, activityIndex: actIdx, score };
        console.log(`  [Match found] Score: ${score} for "${activity.name}"`);
      }
    }
  }

  if (bestMatch && bestMatch.score >= 40) {
    console.log(`[AI Assistant] Best match: "${bestMatch.activity.name}" with score ${bestMatch.score}`);
    return { activity: bestMatch.activity, dayIndex: bestMatch.dayIndex, activityIndex: bestMatch.activityIndex };
  }

  console.log(`[AI Assistant] No matching activity found for "${searchName}"`);
  return null;
}

// Build system prompt for structured responses
function buildSystemPrompt(tripContext: TripContext): string {
  return `You are MonkeyTravel's AI assistant - concise, helpful, and action-oriented.

TRIP CONTEXT:
- Destination: ${tripContext.destination}
- Dates: ${tripContext.startDate} to ${tripContext.endDate} (${tripContext.dayCount} days)
- Activities: ${tripContext.activityCount} planned
${tripContext.budget ? `- Budget: ${tripContext.budget.currency} ${tripContext.budget.total}` : ""}

CURRENT ITINERARY:
${tripContext.itinerary.map((day) => `Day ${day.day_number}: ${day.activities.map((a) => `${a.name} (${a.type})`).join(", ")}`).join("\n")}

RESPONSE FORMAT - Return valid JSON only:
{
  "summary": "Brief 1-2 sentence response",
  "cards": [
    // Optional array of cards for rich display
  ],
  "action": {
    // Optional - only if you're making a change
    "type": "replace_activity" | "add_activity" | "remove_activity",
    "applied": true,
    "activityId": "id of affected activity",
    "dayNumber": 1,
    "newActivity": { /* full activity object if adding/replacing */ }
  }
}

CARD TYPES:
1. activity_suggestion: { "type": "activity_suggestion", "activity": {...}, "dayNumber": 1, "reason": "why" }
2. activity_replacement: { "type": "activity_replacement", "oldActivity": {"id": "", "name": "", "type": ""}, "newActivity": {...}, "dayNumber": 1, "reason": "why", "autoApplied": true }
3. tip: { "type": "tip", "icon": "lightbulb|warning|info|clock|money|weather", "title": "...", "content": "..." }
4. comparison: { "type": "comparison", "title": "...", "options": [{"name": "", "pros": [], "cons": [], "recommended": true}] }
5. confirmation: { "type": "confirmation", "icon": "check|swap|plus|trash", "title": "...", "description": "..." }

ACTIVITY OBJECT FORMAT:
{
  "id": "act_xxx",
  "time_slot": "morning|afternoon|evening",
  "start_time": "HH:MM",
  "duration_minutes": 90,
  "name": "Activity Name",
  "type": "attraction|restaurant|activity|transport",
  "description": "Brief description",
  "location": "Neighborhood/Area",
  "estimated_cost": { "amount": 25, "currency": "EUR", "tier": "budget|moderate|expensive" },
  "tips": ["tip1"],
  "booking_required": false
}

GUIDELINES:
- Be CONCISE - summaries should be 1-2 sentences max
- When user asks to replace/add, ALWAYS include the full new activity object
- Use cards to show structured info instead of long text
- For tips/advice, use tip cards with appropriate icons
- For comparisons, use comparison cards with pros/cons
- Always confirm actions with confirmation cards
- Keep the trip's existing style and budget level in mind`;
}

// Extract geographic context from activities (neighborhoods, areas, addresses)
function extractGeographicContext(activities: Activity[]): {
  neighborhoods: string[];
  addresses: string[];
  summary: string;
} {
  const neighborhoods = new Set<string>();
  const addresses: string[] = [];

  for (const activity of activities) {
    // Extract location/neighborhood
    if (activity.location) {
      neighborhoods.add(activity.location);
    }
    // Extract address
    if (activity.address) {
      addresses.push(`${activity.name}: ${activity.address}`);
    }
  }

  const neighborhoodList = Array.from(neighborhoods);
  const summary = neighborhoodList.length > 0
    ? `Activities are concentrated in: ${neighborhoodList.join(", ")}`
    : addresses.length > 0
      ? `Activities are located at: ${addresses.slice(0, 3).join("; ")}`
      : "";

  return {
    neighborhoods: neighborhoodList,
    addresses,
    summary,
  };
}

// Detect activity type from user preference text
function detectActivityType(preference: string): string | undefined {
  const lowerPref = preference.toLowerCase();

  const typeKeywords: Record<string, string[]> = {
    restaurant: ["restaurant", "food", "eat", "lunch", "dinner", "breakfast", "meal", "dining"],
    museum: ["museum", "gallery", "exhibit", "art", "history"],
    cafe: ["cafe", "coffee", "bakery", "tea", "pastry"],
    attraction: ["attraction", "tourist", "famous", "landmark", "monument", "sight"],
    nature: ["nature", "park", "garden", "beach", "hike", "walk", "outdoor"],
    shopping: ["shop", "shopping", "market", "store", "mall", "boutique"],
    nightlife: ["nightlife", "bar", "club", "pub", "drink", "night"],
    entertainment: ["entertainment", "show", "theater", "cinema", "concert", "performance"],
    activity: ["activity", "tour", "experience", "class", "workshop"],
  };

  for (const [type, keywords] of Object.entries(typeKeywords)) {
    if (keywords.some(kw => lowerPref.includes(kw))) {
      return type;
    }
  }

  return undefined; // Let the bank search across all types
}

// Get default start time for a time slot
function getDefaultStartTime(timeSlot: "morning" | "afternoon" | "evening"): string {
  switch (timeSlot) {
    case "morning": return "10:00";
    case "afternoon": return "14:00";
    case "evening": return "19:00";
    default: return "12:00";
  }
}

// Typical operating hours by activity type
const TYPICAL_OPERATING_HOURS: Record<string, { open: string; close: string; bestTimes: string }> = {
  attraction: { open: "09:00", close: "18:00", bestTimes: "Morning (09:00-12:00) or early afternoon (13:00-16:00)" },
  museum: { open: "10:00", close: "18:00", bestTimes: "Morning (10:00-13:00) or early afternoon (14:00-17:00)" },
  restaurant: { open: "12:00", close: "23:00", bestTimes: "Lunch (12:00-14:00) or Dinner (19:00-21:30)" },
  cafe: { open: "08:00", close: "19:00", bestTimes: "Morning (08:00-11:00) or afternoon break (15:00-17:00)" },
  activity: { open: "09:00", close: "20:00", bestTimes: "Depends on activity, generally daylight hours" },
  nature: { open: "06:00", close: "20:00", bestTimes: "Morning (07:00-11:00) or late afternoon (16:00-19:00)" },
  shopping: { open: "10:00", close: "20:00", bestTimes: "Afternoon (14:00-18:00)" },
  nightlife: { open: "20:00", close: "03:00", bestTimes: "Evening/Night (21:00-02:00)" },
  entertainment: { open: "10:00", close: "23:00", bestTimes: "Afternoon or evening (14:00-22:00)" },
  transport: { open: "00:00", close: "23:59", bestTimes: "Any time" },
};

// Generate a new activity using AI with geographic and schedule awareness
// OPTIMIZATION: First tries activity bank (FREE), falls back to AI if no match
async function generateNewActivity(
  genAI: GoogleGenerativeAI,
  destination: string,
  preference: string,
  existingActivity: Activity | null,
  dayNumber: number,
  timeSlot: "morning" | "afternoon" | "evening" = "afternoon",
  sameDayActivities: Activity[] = [], // Other activities on the same day for geographic context
  suggestedStartTime?: string, // Optional: caller-suggested start time (AI can override if unreasonable)
  destinationCoords?: Coordinates, // Destination center coordinates for fallback
  language: SupportedLanguage = "en" // User's language for localization
): Promise<Activity> {
  console.log(`[AI Assistant] Generating new activity for ${destination}, preference: "${preference}"`);

  // OPTIMIZATION: Try activity bank first (FREE - no AI call)
  const existingActivityNames = sameDayActivities.map(a => a.name).filter(Boolean);
  const activityType = detectActivityType(preference);

  const cachedActivity = await findMatchingActivity(destination, preference, {
    type: activityType,
    timeSlot: timeSlot,
    existingActivityNames,
  });

  if (cachedActivity) {
    console.log(`[AI Assistant] CACHE HIT: Found "${cachedActivity.name}" in activity bank (FREE)`);

    // Adjust the cached activity for this context
    cachedActivity.time_slot = timeSlot;
    cachedActivity.start_time = suggestedStartTime || getDefaultStartTime(timeSlot);

    // Generate coordinates if missing
    if (!cachedActivity.coordinates) {
      const existingCoords = sameDayActivities
        .filter(a => a.coordinates?.lat && a.coordinates?.lng)
        .map(a => a.coordinates as Coordinates);

      if (existingCoords.length > 0) {
        const centroid = calculateCentroid(existingCoords);
        if (centroid) {
          cachedActivity.coordinates = generateNearbyCoordinates(centroid, 0.4);
        }
      } else if (destinationCoords) {
        cachedActivity.coordinates = generateNearbyCoordinates(destinationCoords, 1.5);
      }
    }

    return cachedActivity;
  }

  console.log(`[AI Assistant] Cache MISS - falling back to AI generation`);
  console.log(`[AI Assistant] Same-day activities for context: ${sameDayActivities.map(a => `${a.name} (${a.start_time}) (${a.location || a.address || 'no location'})`).join(", ")}`);
  console.log(`[AI Assistant] Suggested start time: ${suggestedStartTime || "not specified"}`);

  // Use Gemini 2.5 Flash for implicit caching (75% discount on repeated prompts)
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  // Extract geographic context from other activities on the same day
  const geoContext = extractGeographicContext(sameDayActivities);

  // Build full schedule context with times
  const scheduleContext = sameDayActivities.length > 0
    ? `\nCURRENT SCHEDULE for Day ${dayNumber} (you MUST find an appropriate gap):
${sameDayActivities
  .sort((a, b) => (a.start_time || "").localeCompare(b.start_time || ""))
  .map(a => {
    const endTime = a.start_time && a.duration_minutes
      ? (() => {
          const [h, m] = a.start_time.split(":").map(Number);
          const endMins = h * 60 + m + a.duration_minutes;
          return formatMinutesToTime(endMins);
        })()
      : "TBD";
    return `  ${a.start_time || "TBD"} - ${endTime}: ${a.name} (${a.type}) - ${a.location || a.address || "location unspecified"}`;
  }).join("\n")}
\nFree time slots to consider:
${(() => {
  // Calculate free slots
  const sorted = [...sameDayActivities].sort((a, b) => (a.start_time || "99:99").localeCompare(b.start_time || "99:99"));
  const freeSlots: string[] = [];
  let lastEnd = 9 * 60; // Day starts at 9:00

  for (const act of sorted) {
    if (!act.start_time) continue;
    const [h, m] = act.start_time.split(":").map(Number);
    const startMins = h * 60 + m;
    if (startMins > lastEnd + 30) { // At least 30 min gap
      const gapStart = formatMinutesToTime(lastEnd);
      const gapEnd = formatMinutesToTime(startMins);
      freeSlots.push(`  ${gapStart} - ${gapEnd} (${startMins - lastEnd} min available)`);
    }
    lastEnd = startMins + (act.duration_minutes || 60);
  }
  // Add evening slot if day ends before 22:00
  if (lastEnd < 22 * 60) {
    const gapStart = formatMinutesToTime(lastEnd);
    freeSlots.push(`  ${gapStart} - 22:00 (${22 * 60 - lastEnd} min available)`);
  }
  return freeSlots.length > 0 ? freeSlots.join("\n") : "  No obvious gaps - consider adjusting existing activities";
})()}
`
    : "";

  // Build geographic constraint section
  let geographicConstraint = "";
  if (geoContext.neighborhoods.length > 0 || geoContext.addresses.length > 0) {
    geographicConstraint = `
GEOGRAPHIC CONSTRAINT (CRITICAL):
The other activities on Day ${dayNumber} are located in these areas:
${geoContext.neighborhoods.map(n => `- ${n}`).join("\n")}
${geoContext.addresses.length > 0 ? `\nSpecific locations:\n${geoContext.addresses.map(a => `- ${a}`).join("\n")}` : ""}

You MUST suggest an activity that is:
1. In the SAME neighborhood/district as the other Day ${dayNumber} activities
2. Within walking distance (max 15-20 minutes walk) from the other activities
3. Geographically logical to visit on the same day without excessive travel

DO NOT suggest activities in other parts of the city that would require long transit.
The goal is to keep Day ${dayNumber} activities clustered together for efficient travel.
`;
  }

  // Build operating hours guidance
  const operatingHoursGuide = `
OPERATING HOURS GUIDANCE (CRITICAL - you MUST respect these):
${Object.entries(TYPICAL_OPERATING_HOURS).map(([type, hours]) =>
  `- ${type}: typically open ${hours.open}-${hours.close}. Best times: ${hours.bestTimes}`
).join("\n")}

NEVER schedule:
- Museums/attractions after 18:00 (they close!)
- Restaurants outside 12:00-14:30 (lunch) or 19:00-22:00 (dinner)
- Outdoor activities after dark
- Any activity at unrealistic hours (e.g., museum at 23:00 is WRONG)
`;

  const langInstruction = getLanguageInstruction(language);
  const prompt = `Generate a travel activity for ${destination}.${langInstruction}
${existingActivity ? `Replacing: ${existingActivity.name} (${existingActivity.type}) at ${existingActivity.start_time || "TBD"} - was located in: ${existingActivity.location || existingActivity.address || "unspecified"}` : "New activity to ADD to the schedule"}
User preference: ${preference}
Preferred time slot: ${timeSlot}
${suggestedStartTime ? `Caller suggested: ${suggestedStartTime} - BUT you should IGNORE this if it's unrealistic for the activity type!` : ""}
Day: ${dayNumber}
${scheduleContext}
${operatingHoursGuide}
${geographicConstraint}

Return ONLY valid JSON for the activity:
{
  "name": "Activity Name",
  "type": "attraction|restaurant|activity|museum|cafe|nature|shopping|nightlife|entertainment|transport",
  "description": "2-3 sentence engaging description",
  "location": "Neighborhood/Area name - MUST be in the same area as other Day ${dayNumber} activities",
  "address": "Specific street address if known",
  "start_time": "HH:MM - MUST be a realistic time when this type of venue would be OPEN and fits in the schedule gaps",
  "duration_minutes": 60-180,
  "estimated_cost": { "amount": number, "currency": "EUR", "tier": "budget|moderate|expensive" },
  "tips": ["1 helpful tip"],
  "booking_required": true/false
}

CRITICAL TIMING RULES:
1. The "start_time" MUST be during the venue's typical operating hours
2. Museums/attractions should be scheduled between 09:00-17:00
3. Restaurants should be scheduled at lunch (12:00-14:00) or dinner (19:00-21:30)
4. Find a gap in the existing schedule - don't overlap with other activities
5. If the user's suggested time is unrealistic (like a museum at 23:00), pick a SENSIBLE time instead`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();

  // Parse JSON from response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error("[AI Assistant] Failed to parse activity JSON from response:", text);
    throw new Error("Failed to generate activity");
  }

  const activity = JSON.parse(jsonMatch[0]) as Activity;
  activity.id = generateActivityId();

  // Generate coordinates for the new activity
  // Priority: 1) Use existing activities centroid, 2) Use destination center
  const existingCoords = sameDayActivities
    .filter(a => a.coordinates?.lat && a.coordinates?.lng)
    .map(a => a.coordinates as Coordinates);

  if (existingCoords.length > 0) {
    // Generate coordinates near the centroid of existing activities
    const centroid = calculateCentroid(existingCoords);
    if (centroid) {
      activity.coordinates = generateNearbyCoordinates(centroid, 0.4); // 400m radius
      console.log(`[AI Assistant] Generated coordinates near activity cluster: ${activity.coordinates.lat.toFixed(5)}, ${activity.coordinates.lng.toFixed(5)}`);
    }
  } else if (destinationCoords) {
    // Fall back to destination center with larger offset
    activity.coordinates = generateNearbyCoordinates(destinationCoords, 1.5); // 1.5km radius
    console.log(`[AI Assistant] Generated coordinates near destination center: ${activity.coordinates.lat.toFixed(5)}, ${activity.coordinates.lng.toFixed(5)}`);
  }

  // Validate and fix the time if AI returned something unreasonable
  const [hours] = (activity.start_time || "12:00").split(":").map(Number);
  const finalActivityType = activity.type?.toLowerCase() || "activity";
  const typeHours = TYPICAL_OPERATING_HOURS[finalActivityType] || TYPICAL_OPERATING_HOURS.activity;
  const [openH] = typeHours.open.split(":").map(Number);
  const [closeH] = typeHours.close.split(":").map(Number);

  // Check if time is within operating hours
  const isNightlife = finalActivityType === "nightlife";
  const isValidTime = isNightlife
    ? (hours >= 20 || hours <= 3) // Nightlife: 20:00-03:00
    : (hours >= openH && hours < closeH); // Normal: within open-close

  if (!isValidTime) {
    console.log(`[AI Assistant] Time ${activity.start_time} is outside operating hours for ${finalActivityType}. Adjusting...`);
    // Pick a sensible default based on time slot
    if (timeSlot === "morning") {
      activity.start_time = finalActivityType === "restaurant" || finalActivityType === "cafe" ? "09:00" : "10:00";
    } else if (timeSlot === "afternoon") {
      activity.start_time = finalActivityType === "restaurant" ? "13:00" : "14:00";
    } else {
      activity.start_time = finalActivityType === "restaurant" ? "19:30" : finalActivityType === "nightlife" ? "21:00" : "17:00";
    }
    console.log(`[AI Assistant] Adjusted to ${activity.start_time}`);
  }

  // Set time slot based on actual start time
  const finalHours = parseInt(activity.start_time?.split(":")[0] || "12");
  if (finalHours < 12) activity.time_slot = "morning";
  else if (finalHours < 17) activity.time_slot = "afternoon";
  else activity.time_slot = "evening";

  console.log(`[AI Assistant] Generated activity: "${activity.name}" at ${activity.start_time} in location: "${activity.location}"`);

  // OPTIMIZATION: Save AI-generated activity to bank for future cache hits (fire-and-forget)
  // This ensures subsequent users asking for similar activities get FREE cache hits
  saveToActivityBank(destination, activity).then((saved) => {
    if (saved) {
      console.log(`[AI Assistant] Activity saved to bank for future use`);
    }
  });

  return activity;
}

export async function POST(request: NextRequest) {
  const requestStartTime = Date.now();
  console.log("[AI Assistant] POST request received");

  try {
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // Get user's preferred language for AI content localization
    const userLanguage = await getUserLanguage(supabase, user.id);
    console.log(`[AI Assistant] User language: ${userLanguage}`);

    // Check early access (during early access period)
    const earlyAccess = await checkEarlyAccess(user.id, "assistant", user.email);
    if (!earlyAccess.allowed) {
      return errors.forbidden(earlyAccess.message || "Early access required", earlyAccess.error);
    }

    const body: AssistantRequest = await request.json();
    const { tripId, message, conversationId, itinerary: clientItinerary, previewMode = false } = body;

    console.log(`[AI Assistant] Message: "${message}"`);
    console.log(`[AI Assistant] Trip ID: ${tripId}`);
    console.log(`[AI Assistant] Client itinerary provided: ${!!clientItinerary}`);
    console.log(`[AI Assistant] Preview mode: ${previewMode}`);

    if (!tripId || !message) {
      return errors.badRequest("Missing tripId or message");
    }

    // Check API access control
    const access = await checkApiAccess("gemini");
    if (!access.allowed) {
      await logApiCall({
        apiName: "gemini",
        endpoint: "/api/ai/assistant",
        status: 503,
        responseTimeMs: Date.now() - requestStartTime,
        cacheHit: false,
        costUsd: 0,
        error: `BLOCKED: ${access.message}`,
        metadata: { user_id: user.id, trip_id: tripId },
      });
      return errors.serviceUnavailable(access.message || "AI assistant is currently disabled");
    }

    // Check usage limits (daily limit for assistant messages)
    const usageCheck = await checkUsageLimit(user.id, "aiAssistantMessages", user.email);
    if (!usageCheck.allowed) {
      return errors.rateLimit(
        usageCheck.message || "Daily AI assistant message limit reached.",
        { usage: usageCheck, upgradeUrl: "/pricing" }
      );
    }

    // Fetch trip data
    const { data: trip, error: tripError } = await supabase
      .from("trips")
      .select("*")
      .eq("id", tripId)
      .eq("user_id", user.id)
      .single();

    if (tripError || !trip) {
      return errors.notFound("Trip not found");
    }

    // Use client itinerary if provided (for real-time edits), otherwise use DB
    const itinerary = (clientItinerary || trip.itinerary || []) as ItineraryDay[];
    console.log(`[AI Assistant] Itinerary has ${itinerary.length} days`);

    // Fetch destination coordinates from database for generating activity coordinates
    const destinationName = trip.title.replace(/ Trip$/, "");
    let destinationCoords: Coordinates | undefined;

    const { data: destData } = await supabase
      .from("destinations")
      .select("latitude, longitude")
      .or(`name.ilike.%${destinationName}%,city.ilike.%${destinationName}%`)
      .not("latitude", "is", null)
      .not("longitude", "is", null)
      .limit(1)
      .single();

    if (destData?.latitude && destData?.longitude) {
      destinationCoords = { lat: destData.latitude, lng: destData.longitude };
      console.log(`[AI Assistant] Destination coordinates: ${destinationCoords.lat}, ${destinationCoords.lng}`);
    } else {
      console.log(`[AI Assistant] No coordinates found for destination: ${destinationName}`);
    }

    const tripContext: TripContext = {
      id: trip.id,
      title: trip.title,
      destination: trip.title.replace(/ Trip$/, ""),
      startDate: trip.start_date,
      endDate: trip.end_date,
      budget: trip.budget,
      itinerary,
      dayCount: itinerary.length,
      activityCount: itinerary.reduce((sum, day) => sum + day.activities.length, 0),
    };

    // Detect if user wants to modify activities
    const actionIntent = detectActionIntent(message);
    console.log(`[AI Assistant] Action intent: ${JSON.stringify(actionIntent)}`);

    // Deep clone the itinerary to avoid reference issues
    let modifiedItinerary: ItineraryDay[] = JSON.parse(JSON.stringify(itinerary));
    let actionTaken: StructuredAssistantResponse["action"] | undefined;
    let replacementCard: AssistantCard | undefined;
    let replacementError: string | undefined;
    let itineraryWasModified = false;

    // Handle autonomous activity replacement
    if (actionIntent.type === "replace" && actionIntent.activityName) {
      console.log(`[AI Assistant] Attempting to replace activity: "${actionIntent.activityName}"`);

      const found = findActivityByName(itinerary, actionIntent.activityName);

      if (found) {
        console.log(`[AI Assistant] Found activity to replace: "${found.activity.name}" on Day ${found.dayIndex + 1}`);

        try {
          // Get other activities on the same day (excluding the one being replaced) for geographic context
          const sameDayActivities = itinerary[found.dayIndex].activities.filter(
            (a, idx) => idx !== found.activityIndex
          );
          console.log(`[AI Assistant] Same-day activities for geographic context: ${sameDayActivities.map(a => a.name).join(", ")}`);

          // Generate replacement activity with geographic awareness
          const newActivity = await generateNewActivity(
            genAI,
            tripContext.destination,
            message,
            found.activity,
            found.dayIndex + 1,
            found.activity.time_slot,
            sameDayActivities, // Pass other activities for geographic clustering
            undefined, // suggestedStartTime - use original
            destinationCoords, // Destination center for coordinate fallback
            userLanguage // User's language for localization
          );

          // Preserve time from original
          newActivity.start_time = found.activity.start_time;
          newActivity.duration_minutes = found.activity.duration_minutes || newActivity.duration_minutes;

          // Apply the replacement to our deep-cloned itinerary
          modifiedItinerary[found.dayIndex].activities[found.activityIndex] = newActivity;
          itineraryWasModified = true;

          actionTaken = {
            type: "replace_activity",
            applied: true,
            activityId: found.activity.id,
            dayNumber: found.dayIndex + 1,
            newActivity,
          };

          replacementCard = {
            type: "activity_replacement",
            oldActivity: {
              id: found.activity.id || "",
              name: found.activity.name,
              type: found.activity.type,
            },
            newActivity,
            dayNumber: found.dayIndex + 1,
            reason: `Replaced based on your preference`,
            autoApplied: !previewMode, // Only auto-applied if not in preview mode
          };

          // In preview mode, don't save - just prepare the pending change
          if (previewMode) {
            console.log(`[AI Assistant] Preview mode: Preparing pending change for user confirmation`);
            // Keep itineraryWasModified false since we haven't actually saved
            itineraryWasModified = false;
          } else {
            // Save to database (auto-apply mode)
            console.log(`[AI Assistant] Saving modified itinerary to database...`);
            const { error: updateError } = await supabase
              .from("trips")
              .update({
                itinerary: modifiedItinerary,
                updated_at: new Date().toISOString(),
              })
              .eq("id", tripId);

            if (updateError) {
              console.error("[AI Assistant] Database update failed:", updateError);
              replacementError = "Failed to save changes to database";
              itineraryWasModified = false;
            } else {
              console.log(`[AI Assistant] Successfully replaced "${found.activity.name}" with "${newActivity.name}"`);
            }
          }
        } catch (err) {
          console.error("[AI Assistant] Failed to generate replacement activity:", err);
          replacementError = `Failed to generate replacement: ${err instanceof Error ? err.message : "Unknown error"}`;
          // Reset actionTaken since replacement failed
          actionTaken = undefined;
          replacementCard = undefined;
        }
      } else {
        console.log(`[AI Assistant] Could not find activity matching "${actionIntent.activityName}"`);
        replacementError = `Could not find an activity matching "${actionIntent.activityName}" in your itinerary`;
      }
    }

    // Handle autonomous activity ADD
    if (actionIntent.type === "add") {
      console.log(`[AI Assistant] Attempting to add activity: "${actionIntent.preference}"`);

      try {
        // Determine which day to add to (default to day 1 if not specified)
        const targetDayNumber = actionIntent.dayNumber || 1;
        const targetDayIndex = Math.min(targetDayNumber - 1, modifiedItinerary.length - 1);
        const targetDay = modifiedItinerary[targetDayIndex];

        if (!targetDay) {
          console.error(`[AI Assistant] Day ${targetDayNumber} not found in itinerary`);
          replacementError = `Day ${targetDayNumber} not found in your itinerary`;
        } else {
          // Determine time slot based on existing activities
          const existingSlots = new Set(targetDay.activities.map(a => a.time_slot));
          let targetTimeSlot: "morning" | "afternoon" | "evening" = "afternoon";
          let startTime = "12:00";

          // Find an available slot or insert between activities
          if (!existingSlots.has("morning")) {
            targetTimeSlot = "morning";
            startTime = "09:00";
          } else if (!existingSlots.has("afternoon")) {
            targetTimeSlot = "afternoon";
            startTime = "14:00";
          } else if (!existingSlots.has("evening")) {
            targetTimeSlot = "evening";
            startTime = "18:00";
          } else {
            // All slots taken, find the best insertion point
            const lastActivity = targetDay.activities[targetDay.activities.length - 1];
            if (lastActivity) {
              // Parse the last activity end time and add after it
              const [hours, mins] = lastActivity.start_time.split(":").map(Number);
              const endMinutes = hours * 60 + mins + (lastActivity.duration_minutes || 90);
              const newHours = Math.floor(endMinutes / 60);
              const newMins = endMinutes % 60;
              startTime = `${String(newHours).padStart(2, "0")}:${String(newMins).padStart(2, "0")}`;

              if (newHours < 12) targetTimeSlot = "morning";
              else if (newHours < 17) targetTimeSlot = "afternoon";
              else targetTimeSlot = "evening";
            }
          }

          console.log(`[AI Assistant] Adding to Day ${targetDayNumber}, slot: ${targetTimeSlot}, suggested time: ${startTime}`);

          // Get existing activities on this day for geographic and schedule context
          const existingDayActivities = targetDay.activities;
          console.log(`[AI Assistant] Existing activities on Day ${targetDayNumber}: ${existingDayActivities.map(a => `${a.name} at ${a.start_time}`).join(", ")}`);

          // Generate the new activity with full schedule awareness
          // The AI will pick an appropriate time based on:
          // 1. The activity type's typical operating hours
          // 2. The gaps in the existing schedule
          // 3. The suggested time slot preference
          const newActivity = await generateNewActivity(
            genAI,
            tripContext.destination,
            actionIntent.preference || message,
            null,
            targetDayNumber,
            targetTimeSlot,
            existingDayActivities, // Pass existing activities for geographic clustering
            startTime, // Pass as a SUGGESTION - AI can override if unrealistic
            destinationCoords, // Destination center for coordinate fallback
            userLanguage // User's language for localization
          );

          // DO NOT override the AI's chosen time - it has considered operating hours
          console.log(`[AI Assistant] AI chose time: ${newActivity.start_time} for ${newActivity.name} (${newActivity.type})`);

          // Add to the day's activities and sort by time
          modifiedItinerary[targetDayIndex].activities.push(newActivity);
          modifiedItinerary[targetDayIndex].activities.sort((a, b) =>
            a.start_time.localeCompare(b.start_time)
          );
          itineraryWasModified = true;

          actionTaken = {
            type: "add_activity",
            applied: true,
            dayNumber: targetDayNumber,
            newActivity,
          };

          // Create an activity_added card for the added activity
          replacementCard = {
            type: "activity_added",
            activity: newActivity,
            dayNumber: targetDayNumber,
            reason: `Added based on your request`,
            autoApplied: !previewMode, // Only auto-applied if not in preview mode
          } as AssistantCard;

          // In preview mode, don't save - just prepare the pending change
          if (previewMode) {
            console.log(`[AI Assistant] Preview mode: Preparing pending add for user confirmation`);
            // Keep itineraryWasModified false since we haven't actually saved
            itineraryWasModified = false;
          } else {
            // Save to database (auto-apply mode)
            console.log(`[AI Assistant] Saving modified itinerary with new activity to database...`);
            const { error: updateError } = await supabase
              .from("trips")
              .update({
                itinerary: modifiedItinerary,
                updated_at: new Date().toISOString(),
              })
              .eq("id", tripId);

            if (updateError) {
              console.error("[AI Assistant] Database update failed:", updateError);
              replacementError = "Failed to save changes to database";
              itineraryWasModified = false;
            } else {
              console.log(`[AI Assistant] Successfully added "${newActivity.name}" to Day ${targetDayNumber}`);
            }
          }
        }
      } catch (err) {
        console.error("[AI Assistant] Failed to generate new activity:", err);
        replacementError = `Failed to generate activity: ${err instanceof Error ? err.message : "Unknown error"}`;
        actionTaken = undefined;
        replacementCard = undefined;
      }
    }

    // Handle duration adjustment
    if (actionIntent.type === "adjust_duration" && actionIntent.activityName) {
      console.log(`[AI Assistant] Attempting to adjust duration for: "${actionIntent.activityName}"`);

      const found = findActivityByName(itinerary, actionIntent.activityName);

      if (found) {
        const oldDuration = found.activity.duration_minutes || 60;
        let newDuration: number;

        if (actionIntent.newDuration === -1) {
          // Extend by 30 minutes (default)
          newDuration = oldDuration + 30;
          console.log(`[AI Assistant] Extending ${found.activity.name} from ${oldDuration} to ${newDuration} minutes`);
        } else if (actionIntent.newDuration === -2) {
          // Shorten by 30 minutes (minimum 30 minutes)
          newDuration = Math.max(30, oldDuration - 30);
          console.log(`[AI Assistant] Shortening ${found.activity.name} from ${oldDuration} to ${newDuration} minutes`);
        } else {
          newDuration = actionIntent.newDuration!;
          console.log(`[AI Assistant] Setting ${found.activity.name} duration to ${newDuration} minutes`);
        }

        // Update the activity duration
        modifiedItinerary[found.dayIndex].activities[found.activityIndex].duration_minutes = newDuration;

        // Adjust subsequent activities' start times on the same day
        const dayActivities = modifiedItinerary[found.dayIndex].activities;
        for (let i = found.activityIndex + 1; i < dayActivities.length; i++) {
          const prevActivity = dayActivities[i - 1];
          const [prevHours, prevMins] = prevActivity.start_time.split(":").map(Number);
          const prevEnd = prevHours * 60 + prevMins + (prevActivity.duration_minutes || 60);
          const newHours = Math.floor(prevEnd / 60);
          const newMins = prevEnd % 60;
          dayActivities[i].start_time = `${String(newHours).padStart(2, "0")}:${String(newMins).padStart(2, "0")}`;
        }

        itineraryWasModified = true;

        actionTaken = {
          type: "adjust_duration",
          applied: true,
          activityId: found.activity.id,
          dayNumber: found.dayIndex + 1,
        };

        replacementCard = {
          type: "duration_adjusted",
          activity: {
            id: found.activity.id || "",
            name: found.activity.name,
            type: found.activity.type,
          },
          oldDuration,
          newDuration,
          dayNumber: found.dayIndex + 1,
          reason: `Duration adjusted from ${Math.floor(oldDuration / 60)}h${oldDuration % 60 > 0 ? ` ${oldDuration % 60}m` : ""} to ${Math.floor(newDuration / 60)}h${newDuration % 60 > 0 ? ` ${newDuration % 60}m` : ""}`,
          autoApplied: !previewMode,
        } as AssistantCard;

        if (previewMode) {
          console.log(`[AI Assistant] Preview mode: Preparing pending duration change`);
          itineraryWasModified = false;
        } else {
          const { error: updateError } = await supabase
            .from("trips")
            .update({
              itinerary: modifiedItinerary,
              updated_at: new Date().toISOString(),
            })
            .eq("id", tripId);

          if (updateError) {
            console.error("[AI Assistant] Database update failed:", updateError);
            replacementError = "Failed to save changes to database";
            itineraryWasModified = false;
          } else {
            console.log(`[AI Assistant] Successfully adjusted duration for "${found.activity.name}"`);
          }
        }
      } else {
        replacementError = `Could not find an activity matching "${actionIntent.activityName}" in your itinerary`;
      }
    }

    // Handle schedule optimization/reordering
    if (actionIntent.type === "reorder") {
      console.log(`[AI Assistant] Attempting to reorder/optimize schedule`);

      try {
        // Determine which day to optimize (default to day 1 or use specified day)
        const targetDayNumber = actionIntent.dayNumber || 1;
        const targetDayIndex = Math.min(targetDayNumber - 1, modifiedItinerary.length - 1);
        const targetDay = modifiedItinerary[targetDayIndex];

        if (!targetDay || targetDay.activities.length < 2) {
          replacementError = targetDay?.activities.length < 2
            ? `Day ${targetDayNumber} has only ${targetDay?.activities.length || 0} activities - nothing to reorder`
            : `Day ${targetDayNumber} not found in your itinerary`;
        } else {
          // If moving a specific activity to a time slot
          if (actionIntent.activityName && actionIntent.targetTimeSlot) {
            const found = findActivityByName([targetDay], actionIntent.activityName);
            if (found) {
              const activity = targetDay.activities.splice(found.activityIndex, 1)[0];

              // Determine new position based on target time slot
              let insertIndex = 0;
              let newStartTime = "09:00";

              if (actionIntent.targetTimeSlot === "morning") {
                insertIndex = 0;
                newStartTime = "09:00";
                activity.time_slot = "morning";
              } else if (actionIntent.targetTimeSlot === "afternoon") {
                // Find first afternoon activity or insert in middle
                insertIndex = targetDay.activities.findIndex(a =>
                  a.time_slot === "afternoon" || a.time_slot === "evening"
                );
                if (insertIndex === -1) insertIndex = Math.floor(targetDay.activities.length / 2);
                newStartTime = "13:00";
                activity.time_slot = "afternoon";
              } else {
                // Evening - insert at end
                insertIndex = targetDay.activities.length;
                newStartTime = "18:00";
                activity.time_slot = "evening";
              }

              activity.start_time = newStartTime;
              targetDay.activities.splice(insertIndex, 0, activity);

              // Recalculate all start times based on new order
              let currentTime = 9 * 60; // Start at 9:00 AM
              for (const act of targetDay.activities) {
                const hours = Math.floor(currentTime / 60);
                const mins = currentTime % 60;
                act.start_time = `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;

                // Update time slot based on actual time
                if (hours < 12) act.time_slot = "morning";
                else if (hours < 17) act.time_slot = "afternoon";
                else act.time_slot = "evening";

                currentTime += (act.duration_minutes || 60) + 30; // Add 30 min buffer between activities
              }

              itineraryWasModified = true;
              modifiedItinerary[targetDayIndex] = targetDay;

              actionTaken = {
                type: "reorder",
                applied: true,
                dayNumber: targetDayNumber,
              };

              replacementCard = {
                type: "schedule_reordered",
                dayNumber: targetDayNumber,
                reason: `Moved "${activity.name}" to ${actionIntent.targetTimeSlot}`,
                activities: targetDay.activities.map(a => ({
                  id: a.id || "",
                  name: a.name,
                  time: a.start_time,
                  timeSlot: a.time_slot,
                })),
                autoApplied: !previewMode,
              } as AssistantCard;
            } else {
              replacementError = `Could not find activity "${actionIntent.activityName}" on Day ${targetDayNumber}`;
            }
          } else {
            // Full day optimization - use AI to suggest optimal order
            // Use Gemini 2.5 Flash for implicit caching (75% discount on repeated prompts)
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

            const activitiesInfo = targetDay.activities.map((a, i) => ({
              index: i,
              name: a.name,
              type: a.type,
              location: a.location || a.address || "unknown",
              duration: a.duration_minutes || 60,
              currentTime: a.start_time,
            }));

            const optimizePrompt = `You are optimizing a day's travel itinerary for ${tripContext.destination}.

Current activities on Day ${targetDayNumber}:
${activitiesInfo.map(a => `${a.index}. ${a.name} (${a.type}) at ${a.location} - ${a.duration}min`).join("\n")}

Suggest the optimal order for these activities considering:
1. Geographic proximity (minimize travel between locations)
2. Typical opening hours (museums morning, restaurants lunch/dinner, nightlife evening)
3. Activity type flow (don't have two heavy meals back-to-back)

Return ONLY a JSON array with the optimal order of activity indices:
{"optimalOrder": [0, 2, 1, 3], "reason": "Brief explanation of why this order is better"}`;

            const result = await model.generateContent(optimizePrompt);
            const text = result.response.text();
            const jsonMatch = text.match(/\{[\s\S]*\}/);

            if (jsonMatch) {
              const optimization = JSON.parse(jsonMatch[0]) as { optimalOrder: number[]; reason: string };

              // Reorder activities based on AI suggestion
              const reorderedActivities = optimization.optimalOrder
                .filter(idx => idx < targetDay.activities.length)
                .map(idx => targetDay.activities[idx]);

              // If some activities weren't included, add them at the end
              const includedIndices = new Set(optimization.optimalOrder);
              for (let i = 0; i < targetDay.activities.length; i++) {
                if (!includedIndices.has(i)) {
                  reorderedActivities.push(targetDay.activities[i]);
                }
              }

              // Recalculate start times
              let currentTime = 9 * 60;
              for (const act of reorderedActivities) {
                const hours = Math.floor(currentTime / 60);
                const mins = currentTime % 60;
                act.start_time = `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;

                if (hours < 12) act.time_slot = "morning";
                else if (hours < 17) act.time_slot = "afternoon";
                else act.time_slot = "evening";

                currentTime += (act.duration_minutes || 60) + 30;
              }

              modifiedItinerary[targetDayIndex].activities = reorderedActivities;
              itineraryWasModified = true;

              actionTaken = {
                type: "reorder",
                applied: true,
                dayNumber: targetDayNumber,
              };

              replacementCard = {
                type: "schedule_optimized",
                dayNumber: targetDayNumber,
                reason: optimization.reason || "Optimized for efficient travel and activity flow",
                activities: reorderedActivities.map(a => ({
                  id: a.id || "",
                  name: a.name,
                  time: a.start_time,
                  timeSlot: a.time_slot,
                })),
                autoApplied: !previewMode,
              } as AssistantCard;
            } else {
              replacementError = "Failed to generate optimized schedule";
            }
          }

          if (itineraryWasModified && previewMode) {
            console.log(`[AI Assistant] Preview mode: Preparing pending reorder`);
            itineraryWasModified = false;
          } else if (itineraryWasModified && !previewMode) {
            const { error: updateError } = await supabase
              .from("trips")
              .update({
                itinerary: modifiedItinerary,
                updated_at: new Date().toISOString(),
              })
              .eq("id", tripId);

            if (updateError) {
              console.error("[AI Assistant] Database update failed:", updateError);
              replacementError = "Failed to save changes to database";
              itineraryWasModified = false;
            } else {
              console.log(`[AI Assistant] Successfully optimized Day ${targetDayNumber} schedule`);
            }
          }
        }
      } catch (err) {
        console.error("[AI Assistant] Failed to optimize schedule:", err);
        replacementError = `Failed to optimize schedule: ${err instanceof Error ? err.message : "Unknown error"}`;
        actionTaken = undefined;
        replacementCard = undefined;
      }
    }

    // Load conversation
    let conversation: { id: string; messages: AssistantMessage[] };

    if (conversationId) {
      const { data: existingConvo } = await supabase
        .from("ai_conversations")
        .select("*")
        .eq("id", conversationId)
        .eq("user_id", user.id)
        .single();

      conversation = existingConvo
        ? { id: existingConvo.id, messages: existingConvo.messages as AssistantMessage[] }
        : { id: "", messages: [] };
    } else {
      const { data: newConvo } = await supabase
        .from("ai_conversations")
        .insert({ user_id: user.id, trip_id: tripId, messages: [] })
        .select()
        .single();

      conversation = { id: newConvo?.id || "", messages: [] };
    }

    // Classify and select model
    const contextLength = JSON.stringify(tripContext).length;
    const classification = classifyTask(message, contextLength);
    const modelConfig = selectModel(classification);

    // Build conversation context
    const recentMessages = conversation.messages.slice(-4);
    const conversationHistory = recentMessages
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n");

    // Build prompt with action context
    let actionContext = "";
    if (actionTaken && replacementCard) {
      if (actionTaken.type === "replace_activity") {
        const rc = replacementCard as { oldActivity: { name: string }; newActivity: { name: string } };
        actionContext = `
IMPORTANT: I have already replaced "${rc.oldActivity.name}" with "${rc.newActivity.name}".
Include the replacement card in your response and confirm the change was made.
The change has been saved to the database and will appear in the itinerary.`;
      } else if (actionTaken.type === "add_activity") {
        const ac = replacementCard as { activity: { name: string }; dayNumber: number };
        actionContext = `
IMPORTANT: I have already added "${ac.activity.name}" to Day ${ac.dayNumber} of the itinerary.
Include the activity_suggestion card in your response and confirm the activity was added.
The change has been saved to the database and will appear in the itinerary.`;
      }
    } else if (replacementError) {
      actionContext = `
NOTE: The user tried to modify the itinerary, but it failed: ${replacementError}
Explain this to the user and suggest alternatives.`;
    }

    const systemPrompt = buildSystemPrompt(tripContext);
    const languageInstruction = getLanguageInstruction(userLanguage);
    const fullPrompt = `${systemPrompt}${languageInstruction}
${actionContext}
${conversationHistory ? `\nRecent conversation:\n${conversationHistory}\n` : ""}
User: ${message}

Respond with valid JSON only.`;

    // Call AI
    const model = genAI.getGenerativeModel({ model: modelConfig.id });
    const result = await model.generateContent(fullPrompt);
    const responseText = result.response.text();

    // Parse JSON response
    let parsedResponse: StructuredAssistantResponse;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedResponse = JSON.parse(jsonMatch[0]);
      } else {
        // Fallback to plain text response
        parsedResponse = {
          summary: responseText.slice(0, 200),
          cards: [],
        };
      }
    } catch {
      parsedResponse = {
        summary: responseText.slice(0, 200),
        cards: [],
      };
    }

    // Add replacement card if we performed one
    if (replacementCard) {
      parsedResponse.cards = [replacementCard, ...(parsedResponse.cards || [])];
      parsedResponse.action = actionTaken;
    }

    // Estimate tokens and cost
    const inputTokens = Math.ceil(fullPrompt.length / 4);
    const outputTokens = Math.ceil(responseText.length / 4);
    const costCents = estimateCost(modelConfig, inputTokens, outputTokens);

    // Record usage in existing system
    await recordUsage({
      userId: user.id,
      tripId,
      modelId: modelConfig.id,
      action: actionTaken?.type || "answer_question",
      inputTokens,
      outputTokens,
      costCents,
    });

    // Increment usage counter in new tier-based system
    await incrementUsage(user.id, "aiAssistantMessages", 1);
    // Also increment early access usage
    await incrementEarlyAccessUsage(user.id, "assistant");

    // Save messages
    const userMessage: AssistantMessage = {
      role: "user",
      content: message,
      timestamp: new Date().toISOString(),
    };

    const assistantMessage: AssistantMessage = {
      role: "assistant",
      content: parsedResponse.summary,
      cards: parsedResponse.cards,
      action: parsedResponse.action ? {
        type: parsedResponse.action.type,
        applied: parsedResponse.action.applied,
        activityId: parsedResponse.action.activityId,
        dayNumber: parsedResponse.action.dayNumber,
      } : undefined,
      timestamp: new Date().toISOString(),
    };

    await supabase
      .from("ai_conversations")
      .update({
        messages: [...conversation.messages, userMessage, assistantMessage],
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversation.id);

    // Update usage info for response
    const updatedUsage = {
      ...usageCheck,
      used: usageCheck.used + 1,
      remaining: Math.max(0, usageCheck.remaining - 1),
    };

    // Build pending change object for preview mode
    let pendingChange = null;
    if (previewMode && actionTaken && !replacementError) {
      if (actionTaken.type === "replace_activity") {
        const rc = replacementCard as { oldActivity: { id: string; name: string; type: string }; newActivity: Activity };
        // IMPORTANT: Use the oldActivity from replacementCard which was set during the replace logic
        // Do NOT re-search with findActivityByName() as fuzzy matching could find a different activity
        // The replacementCard.oldActivity was captured at line 542-548 using the correct found.activity

        // Get the full activity data from the itinerary using the exact ID we already found
        const oldActivityFull = itinerary
          .flatMap(day => day.activities)
          .find(a => a.id === rc.oldActivity.id) || rc.oldActivity;

        pendingChange = {
          type: "replace" as const,
          oldActivity: oldActivityFull,
          newActivity: actionTaken.newActivity,
          dayNumber: actionTaken.dayNumber,
          reason: "Suggested based on your preference",
        };
      } else if (actionTaken.type === "add_activity") {
        pendingChange = {
          type: "add" as const,
          newActivity: actionTaken.newActivity,
          dayNumber: actionTaken.dayNumber,
          reason: "Suggested based on your request",
        };
      } else if (actionTaken.type === "adjust_duration") {
        const dc = replacementCard as { activity: { id: string; name: string; type: string }; oldDuration: number; newDuration: number; dayNumber: number };
        pendingChange = {
          type: "adjust_duration" as const,
          activity: dc.activity,
          oldDuration: dc.oldDuration,
          newDuration: dc.newDuration,
          dayNumber: dc.dayNumber,
          reason: `Duration change: ${Math.floor(dc.oldDuration / 60)}h${dc.oldDuration % 60 > 0 ? dc.oldDuration % 60 + "m" : ""} → ${Math.floor(dc.newDuration / 60)}h${dc.newDuration % 60 > 0 ? dc.newDuration % 60 + "m" : ""}`,
        };
      } else if (actionTaken.type === "reorder") {
        const rc = replacementCard as { dayNumber: number; reason: string; activities: { id: string; name: string; time: string; timeSlot: string }[] };
        pendingChange = {
          type: "reorder" as const,
          dayNumber: rc.dayNumber,
          activities: rc.activities,
          reason: rc.reason || "Optimized schedule for better flow",
        };
      }
    }

    // CRITICAL: Always return modifiedItinerary if it was actually modified
    const responsePayload = {
      message: assistantMessage,
      conversationId: conversation.id,
      model: modelConfig.name,
      complexity: classification.complexity,
      // Return modified itinerary if we actually made changes
      modifiedItinerary: itineraryWasModified ? modifiedItinerary : undefined,
      // Return previous itinerary for undo functionality (when auto-applied)
      previousItinerary: itineraryWasModified ? itinerary : undefined,
      // Return pending change for confirm-first flow
      pendingChange,
      usage: {
        inputTokens,
        outputTokens,
        costCents,
        tier: updatedUsage.tier,
        remaining: updatedUsage.remaining,
        limit: updatedUsage.limit,
        resetAt: updatedUsage.resetAt,
      },
      // Debug info
      debug: {
        actionIntent: actionIntent.type,
        activityName: actionIntent.activityName,
        itineraryWasModified,
        replacementError,
        previewMode,
      },
    };

    console.log(`[AI Assistant] Response: modifiedItinerary=${!!responsePayload.modifiedItinerary}, itineraryWasModified=${itineraryWasModified}`);

    return apiSuccess(responsePayload);
  } catch (error) {
    console.error("[AI Assistant] POST error:", error);
    return errors.internal("Failed to process request", "AI Assistant");
  }
}

// GET endpoint to fetch conversation history
export async function GET(request: NextRequest) {
  try {
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    const { searchParams } = new URL(request.url);
    const tripId = searchParams.get("tripId");
    const conversationId = searchParams.get("conversationId");

    if (conversationId) {
      const { data: conversation } = await supabase
        .from("ai_conversations")
        .select("*")
        .eq("id", conversationId)
        .eq("user_id", user.id)
        .single();

      return apiSuccess({ conversation });
    }

    if (tripId) {
      const { data: conversations } = await supabase
        .from("ai_conversations")
        .select("id, created_at, updated_at, messages")
        .eq("trip_id", tripId)
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false });

      return apiSuccess({ conversations });
    }

    return errors.badRequest("Missing tripId or conversationId");
  } catch (error) {
    console.error("[AI Assistant] GET error:", error);
    return errors.internal("Failed to fetch conversations", "AI Assistant");
  }
}
