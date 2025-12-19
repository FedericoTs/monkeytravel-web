/**
 * Destination Activity Bank
 *
 * Pre-caches activities per destination to reduce AI API calls by ~90%.
 *
 * Flow:
 * 1. On first trip generation for a destination, generate 50+ activities in ONE AI call
 * 2. Store in destination_activity_bank table with 90-day TTL
 * 3. When user adds activities, search bank first (FREE)
 * 4. Only call AI if no matching activity in bank (rare)
 *
 * Cost savings:
 * - Without bank: $0.003 per activity added (Gemini call)
 * - With bank: $0.003 for initial bank + $0 for subsequent additions
 * - If user adds 10 activities: 90% cost reduction
 */

import { createClient } from "@/lib/supabase/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import crypto from "crypto";
import type { Activity } from "@/types";
import type { Coordinates } from "@/lib/utils/geo";
import { generateActivityId } from "@/lib/utils/activity-id";
import { generateNearbyCoordinates } from "@/lib/utils/geo";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || "");

// Activity types to generate for each destination
const ACTIVITY_TYPES = [
  "attraction",
  "museum",
  "restaurant",
  "cafe",
  "nature",
  "shopping",
  "nightlife",
  "entertainment",
  "landmark",
  "activity",
] as const;

// Number of activities to generate per type (increased for better cache hit rate)
const ACTIVITIES_PER_TYPE = 10;

// Cache duration in days
const CACHE_DURATION_DAYS = 90;

/**
 * Generate a consistent hash for destination lookups
 */
export function hashDestination(destination: string): string {
  const normalized = destination.toLowerCase().trim().replace(/\s+/g, " ");
  return crypto.createHash("md5").update(normalized).digest("hex");
}

/**
 * Search the activity bank for matching activities
 * Returns activities that match the query, type, or keywords
 */
export async function searchActivityBank(
  destination: string,
  options: {
    query?: string;
    type?: string;
    budgetTier?: string;
    timeSlot?: string;
    limit?: number;
  } = {}
): Promise<Activity[]> {
  const supabase = await createClient();
  const destinationHash = hashDestination(destination);
  const { query, type, budgetTier, timeSlot, limit = 10 } = options;

  let queryBuilder = supabase
    .from("destination_activity_bank")
    .select("activity_data, hit_count")
    .eq("destination_hash", destinationHash)
    .gt("expires_at", new Date().toISOString());

  // Apply filters
  if (type) {
    queryBuilder = queryBuilder.eq("activity_type", type);
  }
  if (budgetTier) {
    queryBuilder = queryBuilder.eq("budget_tier", budgetTier);
  }
  if (timeSlot && timeSlot !== "any") {
    queryBuilder = queryBuilder.or(`time_slot.eq.${timeSlot},time_slot.eq.any`);
  }

  // Text search on name
  if (query) {
    const searchTerm = query.toLowerCase().trim();
    queryBuilder = queryBuilder.ilike("activity_name_lower", `%${searchTerm}%`);
  }

  queryBuilder = queryBuilder
    .order("hit_count", { ascending: false })
    .limit(limit);

  const { data, error } = await queryBuilder;

  if (error) {
    console.error("[ActivityBank] Search error:", error);
    return [];
  }

  if (!data || data.length === 0) {
    return [];
  }

  // Update hit counts asynchronously
  const ids = data.map((d: { activity_data: Activity }) =>
    hashDestination(destination) + "_" + (d.activity_data as Activity).name?.toLowerCase()
  );

  // Increment hit counts in background (don't await)
  supabase
    .from("destination_activity_bank")
    .update({
      hit_count: data[0].hit_count + 1,
      last_accessed_at: new Date().toISOString()
    })
    .eq("destination_hash", destinationHash)
    .in("activity_name_lower", ids.slice(0, 5))
    .then(() => {});

  console.log(`[ActivityBank] Found ${data.length} activities for "${destination}" (query: "${query || "none"}")`);

  return data.map((d: { activity_data: Activity }) => ({
    ...d.activity_data,
    id: generateActivityId(), // Generate fresh ID for each use
  }));
}

/**
 * Find a single activity from the bank that best matches the user's request
 */
export async function findMatchingActivity(
  destination: string,
  userRequest: string,
  options: {
    type?: string;
    budgetTier?: string;
    timeSlot?: "morning" | "afternoon" | "evening";
    existingActivityNames?: string[]; // Avoid duplicates
  } = {}
): Promise<Activity | null> {
  const supabase = await createClient();
  const destinationHash = hashDestination(destination);

  // Parse user request to extract keywords
  const keywords = extractKeywords(userRequest);
  console.log(`[ActivityBank] Searching for: "${userRequest}" (keywords: ${keywords.join(", ")})`);

  // First, try exact keyword match in activity_keywords array
  let queryBuilder = supabase
    .from("destination_activity_bank")
    .select("activity_data, hit_count")
    .eq("destination_hash", destinationHash)
    .gt("expires_at", new Date().toISOString());

  if (options.type) {
    queryBuilder = queryBuilder.eq("activity_type", options.type);
  }
  if (options.budgetTier) {
    queryBuilder = queryBuilder.eq("budget_tier", options.budgetTier);
  }
  if (options.timeSlot) {
    queryBuilder = queryBuilder.or(`time_slot.eq.${options.timeSlot},time_slot.eq.any`);
  }

  // Search by keywords using overlap
  if (keywords.length > 0) {
    queryBuilder = queryBuilder.overlaps("activity_keywords", keywords);
  }

  queryBuilder = queryBuilder
    .order("hit_count", { ascending: false })
    .limit(20);

  const { data, error } = await queryBuilder;

  if (error) {
    console.error("[ActivityBank] Search error:", error);
    return null;
  }

  if (!data || data.length === 0) {
    // Fallback: try name-based search
    console.log("[ActivityBank] No keyword match, trying name search...");

    const nameQuery = supabase
      .from("destination_activity_bank")
      .select("activity_data, hit_count")
      .eq("destination_hash", destinationHash)
      .gt("expires_at", new Date().toISOString());

    // Search for any of the keywords in the name
    const nameSearchResults = await nameQuery
      .or(keywords.map(k => `activity_name_lower.ilike.%${k}%`).join(","))
      .limit(10);

    if (nameSearchResults.error || !nameSearchResults.data?.length) {
      console.log("[ActivityBank] No match found in bank");
      return null;
    }

    // Filter out existing activities
    const filtered = nameSearchResults.data.filter((d: { activity_data: Activity }) => {
      const name = (d.activity_data as Activity).name?.toLowerCase();
      return !options.existingActivityNames?.some(
        existing => existing.toLowerCase() === name
      );
    });

    if (filtered.length === 0) {
      return null;
    }

    const bestMatch = filtered[0].activity_data as Activity;
    console.log(`[ActivityBank] Name match found: "${bestMatch.name}"`);

    return {
      ...bestMatch,
      id: generateActivityId(),
    };
  }

  // Filter out existing activities
  const filtered = data.filter((d: { activity_data: Activity }) => {
    const name = (d.activity_data as Activity).name?.toLowerCase();
    return !options.existingActivityNames?.some(
      existing => existing.toLowerCase() === name
    );
  });

  if (filtered.length === 0) {
    console.log("[ActivityBank] All matches already in itinerary");
    return null;
  }

  const bestMatch = filtered[0].activity_data as Activity;
  console.log(`[ActivityBank] Match found: "${bestMatch.name}"`);

  // Update hit count
  supabase
    .from("destination_activity_bank")
    .update({
      hit_count: (data[0].hit_count || 0) + 1,
      last_accessed_at: new Date().toISOString()
    })
    .eq("destination_hash", destinationHash)
    .eq("activity_name_lower", bestMatch.name?.toLowerCase())
    .then(() => {});

  return {
    ...bestMatch,
    id: generateActivityId(),
  };
}

/**
 * Extract keywords from user request for search
 */
function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    "a", "an", "the", "add", "want", "like", "need", "find", "suggest",
    "recommend", "to", "for", "on", "at", "in", "near", "around", "by",
    "day", "morning", "afternoon", "evening", "visit", "go", "see",
    "something", "place", "spot", "somewhere", "good", "nice", "best",
    "please", "can", "could", "would", "should", "i", "me", "my", "we"
  ]);

  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word));
}

/**
 * Check if the activity bank has been populated for a destination
 */
export async function isActivityBankPopulated(destination: string): Promise<boolean> {
  const supabase = await createClient();
  const destinationHash = hashDestination(destination);

  const { count, error } = await supabase
    .from("destination_activity_bank")
    .select("*", { count: "exact", head: true })
    .eq("destination_hash", destinationHash)
    .gt("expires_at", new Date().toISOString());

  if (error) {
    console.error("[ActivityBank] Check error:", error);
    return false;
  }

  // Consider populated if we have at least 20 activities
  const isPopulated = (count || 0) >= 20;
  console.log(`[ActivityBank] ${destination}: ${count} activities cached, populated: ${isPopulated}`);

  return isPopulated;
}

/**
 * Populate the activity bank for a destination
 * Generates 50+ activities across all types in ONE AI call
 */
export async function populateActivityBank(
  destination: string,
  destinationCoords?: Coordinates
): Promise<{ count: number; cost: number }> {
  console.log(`[ActivityBank] Populating bank for: ${destination}`);

  const supabase = await createClient();
  const destinationHash = hashDestination(destination);

  // Check if already populated
  const alreadyPopulated = await isActivityBankPopulated(destination);
  if (alreadyPopulated) {
    console.log(`[ActivityBank] Bank already populated for ${destination}`);
    return { count: 0, cost: 0 };
  }

  // Generate activities using AI - ONE call for all types
  // Use Gemini 2.5 Flash for implicit caching benefits (75% discount on cached tokens)
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  const prompt = `Generate a comprehensive list of activities for ${destination}.

Create ${ACTIVITIES_PER_TYPE} activities for EACH of these categories:
${ACTIVITY_TYPES.map(t => `- ${t}`).join("\n")}

Total: ${ACTIVITY_TYPES.length * ACTIVITIES_PER_TYPE} activities.

For EACH activity, provide:
{
  "name": "Specific place name",
  "type": "category from list above",
  "description": "2-3 sentence engaging description",
  "location": "Neighborhood/District",
  "address": "Street address if known",
  "duration_minutes": 60-180,
  "estimated_cost": { "amount": number, "currency": "EUR/USD/local", "tier": "budget|moderate|expensive" },
  "tips": ["1 helpful tip"],
  "booking_required": true/false,
  "best_time": "morning|afternoon|evening|any",
  "keywords": ["searchable", "keywords", "for", "this", "activity"]
}

IMPORTANT REQUIREMENTS:
1. Use REAL, SPECIFIC place names (not generic like "Local Restaurant")
2. Include a MIX of famous landmarks AND hidden gems
3. Vary the price tiers across activities
4. Include both tourist favorites and local favorites
5. Make keywords specific and searchable (e.g., "impressionist", "seafood", "rooftop")

Return ONLY a JSON array of activities, no other text.`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();

    // Log cache metrics for monitoring
    const usage = result.response.usageMetadata;
    if (usage) {
      const cacheHitRate = usage.promptTokenCount && usage.promptTokenCount > 0
        ? (((usage.cachedContentTokenCount || 0) / usage.promptTokenCount) * 100).toFixed(1)
        : "0.0";
      console.log(
        `[ActivityBank Cache] prompt=${usage.promptTokenCount || 0}, ` +
        `output=${usage.candidatesTokenCount || 0}, ` +
        `cached=${usage.cachedContentTokenCount || 0} (${cacheHitRate}% cache hit)`
      );
    }

    // Parse JSON response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.error("[ActivityBank] Failed to parse activities JSON");
      return { count: 0, cost: 0.003 };
    }

    const activities = JSON.parse(jsonMatch[0]) as Array<{
      name: string;
      type: string;
      description: string;
      location?: string;
      address?: string;
      duration_minutes?: number;
      estimated_cost?: { amount: number; currency: string; tier: string };
      tips?: string[];
      booking_required?: boolean;
      best_time?: string;
      keywords?: string[];
    }>;

    console.log(`[ActivityBank] Generated ${activities.length} activities for ${destination}`);

    // Generate coordinates for each activity
    const activitiesWithCoords = activities.map((activity) => {
      const coords = destinationCoords
        ? generateNearbyCoordinates(destinationCoords, 3) // 3km radius
        : undefined;

      return {
        ...activity,
        coordinates: coords,
      };
    });

    // Prepare records for insertion
    const expiresAt = new Date(Date.now() + CACHE_DURATION_DAYS * 24 * 60 * 60 * 1000);

    const records = activitiesWithCoords.map((activity) => ({
      destination_hash: destinationHash,
      destination_name: destination,
      activity_type: activity.type || "activity",
      activity_name_lower: activity.name?.toLowerCase()?.trim() || "", // REQUIRED for unique constraint
      activity_data: {
        name: activity.name,
        type: activity.type,
        description: activity.description,
        location: activity.location,
        address: activity.address,
        coordinates: activity.coordinates,
        duration_minutes: activity.duration_minutes || 90,
        estimated_cost: activity.estimated_cost,
        tips: activity.tips,
        booking_required: activity.booking_required,
        time_slot: activity.best_time || "any",
      },
      activity_keywords: activity.keywords || extractKeywords(activity.name + " " + activity.description),
      budget_tier: activity.estimated_cost?.tier || "moderate",
      time_slot: activity.best_time || "any",
      expires_at: expiresAt.toISOString(),
      hit_count: 0,
      last_accessed_at: new Date().toISOString(),
    }));

    // Insert in batches to avoid payload limits
    const batchSize = 20;
    let inserted = 0;

    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);

      const { error } = await supabase
        .from("destination_activity_bank")
        .upsert(batch, {
          onConflict: "unique_destination_activity",
          ignoreDuplicates: true
        });

      if (error) {
        console.error(`[ActivityBank] Batch insert error:`, error);
      } else {
        inserted += batch.length;
      }
    }

    console.log(`[ActivityBank] Inserted ${inserted} activities for ${destination}`);

    return {
      count: inserted,
      cost: 0.003 // Single Gemini call
    };
  } catch (err) {
    console.error("[ActivityBank] Population error:", err);
    return { count: 0, cost: 0.003 };
  }
}

/**
 * Get bank statistics for a destination
 */
export async function getActivityBankStats(destination: string): Promise<{
  totalActivities: number;
  byType: Record<string, number>;
  hitCount: number;
  expiresAt: string | null;
}> {
  const supabase = await createClient();
  const destinationHash = hashDestination(destination);

  const { data, error } = await supabase
    .from("destination_activity_bank")
    .select("activity_type, hit_count, expires_at")
    .eq("destination_hash", destinationHash)
    .gt("expires_at", new Date().toISOString());

  if (error || !data) {
    return { totalActivities: 0, byType: {}, hitCount: 0, expiresAt: null };
  }

  const byType: Record<string, number> = {};
  let totalHits = 0;

  for (const row of data) {
    byType[row.activity_type] = (byType[row.activity_type] || 0) + 1;
    totalHits += row.hit_count || 0;
  }

  return {
    totalActivities: data.length,
    byType,
    hitCount: totalHits,
    expiresAt: data[0]?.expires_at || null,
  };
}

/**
 * Save a single AI-generated activity to the bank for future use
 * Called after generateNewActivity creates a new activity via AI
 * This ensures subsequent users asking for similar activities get cache hits
 */
export async function saveToActivityBank(
  destination: string,
  activity: Activity
): Promise<boolean> {
  if (!activity?.name) {
    console.log("[ActivityBank] Cannot save activity: missing name");
    return false;
  }

  const supabase = await createClient();
  const destinationHash = hashDestination(destination);

  // Extract keywords from activity name and description
  const keywords = extractKeywords(
    `${activity.name} ${activity.description || ""} ${activity.type || ""}`
  );

  // Determine budget tier from estimated_cost
  let budgetTier: "budget" | "moderate" | "expensive" = "moderate";
  if (activity.estimated_cost) {
    const cost = typeof activity.estimated_cost === "object"
      ? activity.estimated_cost.amount
      : activity.estimated_cost;
    if (cost < 20) budgetTier = "budget";
    else if (cost > 80) budgetTier = "expensive";
  }

  // Determine time slot
  const timeSlot = activity.time_slot || "any";

  const expiresAt = new Date(Date.now() + CACHE_DURATION_DAYS * 24 * 60 * 60 * 1000);

  try {
    const { error } = await supabase
      .from("destination_activity_bank")
      .upsert({
        destination_hash: destinationHash,
        destination_name: destination,
        activity_type: activity.type || "activity",
        activity_name_lower: activity.name?.toLowerCase()?.trim() || "", // REQUIRED for unique constraint
        activity_data: {
          id: activity.id || generateActivityId(),
          name: activity.name,
          type: activity.type,
          description: activity.description,
          location: activity.location,
          address: activity.address,
          coordinates: activity.coordinates,
          duration_minutes: activity.duration_minutes || 90,
          estimated_cost: activity.estimated_cost,
          tips: activity.tips,
          booking_required: activity.booking_required,
        },
        activity_keywords: keywords,
        budget_tier: budgetTier,
        time_slot: timeSlot,
        expires_at: expiresAt.toISOString(),
        hit_count: 0,
      }, {
        onConflict: "unique_destination_activity"
      });

    if (error) {
      // Ignore duplicate key errors - activity already exists
      if (!error.message?.includes("duplicate")) {
        console.error("[ActivityBank] Save error:", error.message);
      }
      return false;
    }

    console.log(`[ActivityBank] Saved "${activity.name}" to bank for ${destination}`);
    return true;
  } catch (err) {
    console.error("[ActivityBank] Save exception:", err);
    return false;
  }
}
