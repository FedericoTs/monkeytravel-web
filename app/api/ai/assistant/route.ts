import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  classifyTask,
  selectModel,
  estimateCost,
} from "@/lib/ai/config";
import { checkRateLimit, recordUsage } from "@/lib/ai/usage";
import type {
  ItineraryDay,
  Activity,
  AssistantCard,
  StructuredAssistantResponse,
} from "@/types";
import { generateActivityId } from "@/lib/utils/activity-id";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || "");

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

// Detect if user wants to replace/add an activity
function detectActionIntent(message: string): {
  type: "replace" | "add" | "remove" | "none";
  activityName?: string;
  dayNumber?: number;
  preference?: string;
} {
  const lowerMsg = message.toLowerCase();

  // Replace patterns
  const replacePatterns = [
    /replace\s+(?:the\s+)?["']?([^"']+?)["']?\s+(?:with|by|for)/i,
    /swap\s+(?:out\s+)?["']?([^"']+?)["']?\s+(?:with|for)/i,
    /change\s+["']?([^"']+?)["']?\s+to\s+/i,
    /instead\s+of\s+["']?([^"']+?)["']?/i,
    /don['']?t\s+(?:want|like)\s+["']?([^"']+?)["']?/i,
    /(?:can\s+you\s+)?replace\s+["']?([^"']+?)["']?/i,
    /switch\s+["']?([^"']+?)["']?\s+(?:to|with|for)/i,
  ];

  for (const pattern of replacePatterns) {
    const match = message.match(pattern);
    if (match) {
      return {
        type: "replace",
        activityName: match[1].trim(),
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

// Find activity by name (fuzzy match)
function findActivityByName(
  itinerary: ItineraryDay[],
  name: string
): { activity: Activity; dayIndex: number; activityIndex: number } | null {
  const lowerName = name.toLowerCase().trim();

  for (let dayIdx = 0; dayIdx < itinerary.length; dayIdx++) {
    const day = itinerary[dayIdx];
    for (let actIdx = 0; actIdx < day.activities.length; actIdx++) {
      const activity = day.activities[actIdx];
      const activityName = activity.name.toLowerCase();

      // Exact match or contains
      if (activityName === lowerName || activityName.includes(lowerName) || lowerName.includes(activityName)) {
        return { activity, dayIndex: dayIdx, activityIndex: actIdx };
      }
    }
  }

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

// Generate a new activity using AI
async function generateNewActivity(
  genAI: GoogleGenerativeAI,
  destination: string,
  preference: string,
  existingActivity: Activity | null,
  dayNumber: number,
  timeSlot: "morning" | "afternoon" | "evening" = "afternoon"
): Promise<Activity> {
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  const prompt = `Generate a travel activity for ${destination}.
${existingActivity ? `Replacing: ${existingActivity.name} (${existingActivity.type})` : "New activity"}
User preference: ${preference}
Time slot: ${timeSlot}
Day: ${dayNumber}

Return ONLY valid JSON for the activity:
{
  "name": "Activity Name",
  "type": "attraction|restaurant|activity|transport",
  "description": "2-3 sentence engaging description",
  "location": "Neighborhood/Area name",
  "start_time": "HH:MM",
  "duration_minutes": 60-180,
  "estimated_cost": { "amount": number, "currency": "EUR", "tier": "budget|moderate|expensive" },
  "tips": ["1 helpful tip"],
  "booking_required": true/false
}`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();

  // Parse JSON from response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Failed to generate activity");
  }

  const activity = JSON.parse(jsonMatch[0]) as Activity;
  activity.id = generateActivityId();
  activity.time_slot = timeSlot;

  return activity;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body: AssistantRequest = await request.json();
    const { tripId, message, conversationId, itinerary: clientItinerary } = body;

    if (!tripId || !message) {
      return NextResponse.json(
        { error: "Missing tripId or message" },
        { status: 400 }
      );
    }

    // Check rate limit
    const rateLimitCheck = await checkRateLimit(user.id, "free");
    if (!rateLimitCheck.allowed) {
      return NextResponse.json(
        { error: rateLimitCheck.message || "Rate limit exceeded" },
        { status: 429 }
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
      return NextResponse.json({ error: "Trip not found" }, { status: 404 });
    }

    // Use client itinerary if provided (for real-time edits), otherwise use DB
    const itinerary = (clientItinerary || trip.itinerary || []) as ItineraryDay[];

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
    let modifiedItinerary = [...itinerary];
    let actionTaken: StructuredAssistantResponse["action"] | undefined;
    let replacementCard: AssistantCard | undefined;

    // Handle autonomous activity replacement
    if (actionIntent.type === "replace" && actionIntent.activityName) {
      const found = findActivityByName(itinerary, actionIntent.activityName);

      if (found) {
        try {
          // Generate replacement activity
          const newActivity = await generateNewActivity(
            genAI,
            tripContext.destination,
            message,
            found.activity,
            found.dayIndex + 1,
            found.activity.time_slot
          );

          // Preserve time from original
          newActivity.start_time = found.activity.start_time;
          newActivity.duration_minutes = found.activity.duration_minutes || newActivity.duration_minutes;

          // Apply the replacement
          modifiedItinerary[found.dayIndex].activities[found.activityIndex] = newActivity;

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
            autoApplied: true,
          };

          // Save to database
          await supabase
            .from("trips")
            .update({
              itinerary: modifiedItinerary,
              updated_at: new Date().toISOString(),
            })
            .eq("id", tripId);
        } catch (err) {
          console.error("Failed to generate replacement:", err);
        }
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
      actionContext = `
IMPORTANT: I have already replaced "${(replacementCard as any).oldActivity.name}" with a new activity.
Include the replacement card in your response and confirm the change was made.`;
    }

    const systemPrompt = buildSystemPrompt(tripContext);
    const fullPrompt = `${systemPrompt}
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

    // Record usage
    await recordUsage({
      userId: user.id,
      tripId,
      modelId: modelConfig.id,
      action: actionTaken?.type || "answer_question",
      inputTokens,
      outputTokens,
      costCents,
    });

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

    return NextResponse.json({
      message: assistantMessage,
      conversationId: conversation.id,
      model: modelConfig.name,
      complexity: classification.complexity,
      modifiedItinerary: actionTaken?.applied ? modifiedItinerary : undefined,
      usage: {
        inputTokens,
        outputTokens,
        costCents,
        remainingRequests: rateLimitCheck.stats.remainingRequests - 1,
      },
    });
  } catch (error) {
    console.error("AI Assistant error:", error);
    return NextResponse.json(
      { error: "Failed to process request" },
      { status: 500 }
    );
  }
}

// GET endpoint to fetch conversation history
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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

      return NextResponse.json({ conversation });
    }

    if (tripId) {
      const { data: conversations } = await supabase
        .from("ai_conversations")
        .select("id, created_at, updated_at, messages")
        .eq("trip_id", tripId)
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false });

      return NextResponse.json({ conversations });
    }

    return NextResponse.json({ error: "Missing tripId or conversationId" }, { status: 400 });
  } catch (error) {
    console.error("Error fetching conversations:", error);
    return NextResponse.json({ error: "Failed to fetch conversations" }, { status: 500 });
  }
}
