# Gemini Travel Agent Skill

A specialized skill for building AI-powered travel itinerary generation using Google Gemini.

## Overview

This skill provides prompts, configurations, and patterns for integrating Gemini as the core AI engine for travel planning. It handles destination research, itinerary generation, and activity recommendations.

**Updated December 2025** based on research of:
- Google AI Mode Canvas travel planning features
- Gemini 2.5/3 Pro agentic capabilities
- Google ADK (Agent Development Kit)
- Function calling best practices

---

## Model Selection

| Model | Code | Best For | Cost |
|-------|------|----------|------|
| Gemini 2.5 Flash | `gemini-2.5-flash` | MVP (price/performance) | ~$0.003/trip |
| Gemini 2.5 Pro | `gemini-2.5-pro` | Complex reasoning | ~$0.05/trip |
| Gemini 3 Pro | `gemini-3-pro-preview` | Best quality | ~$0.10/trip |

**Recommendation**: Start with `gemini-2.5-flash` for MVP, upgrade to 3 Pro for premium tier.

---

## Gemini Configuration (Updated)

```typescript
// lib/gemini.ts
import { GoogleGenerativeAI, FunctionDeclarationSchemaType } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY!);

// Model configurations by use case
export const MODELS = {
  fast: "gemini-2.5-flash",      // Quick responses, cost-efficient
  thinking: "gemini-2.5-pro",    // Complex reasoning tasks
  premium: "gemini-3-pro-preview", // Best quality, most capable
} as const;

export const geminiConfig = {
  model: MODELS.fast, // Default to cost-efficient model
  generationConfig: {
    temperature: 1.0,  // Keep at 1.0 for Gemini 2.5/3 (recommended by Google)
    topP: 0.95,
    topK: 40,
    maxOutputTokens: 8192,
    responseMimeType: "application/json",
  },
  safetySettings: [
    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
  ],
};

export function getModel(tier: keyof typeof MODELS = "fast") {
  return genAI.getGenerativeModel({
    model: MODELS[tier],
    generationConfig: geminiConfig.generationConfig,
    safetySettings: geminiConfig.safetySettings,
  });
}

// With function calling tools
export function getModelWithTools(tier: keyof typeof MODELS = "fast") {
  return genAI.getGenerativeModel({
    model: MODELS[tier],
    generationConfig: {
      ...geminiConfig.generationConfig,
      responseMimeType: undefined, // Let function calling handle structure
    },
    safetySettings: geminiConfig.safetySettings,
    tools: TRAVEL_TOOLS,
  });
}
```

---

## Function Calling Tools (Agentic Pattern)

Based on Google's function calling best practices:

```typescript
// lib/gemini-tools.ts
import { FunctionDeclarationSchemaType } from "@google/generative-ai";

export const TRAVEL_TOOLS = [
  {
    functionDeclarations: [
      {
        name: "generate_itinerary",
        description: "Generate a complete day-by-day travel itinerary for a destination with activities, restaurants, and timing",
        parameters: {
          type: FunctionDeclarationSchemaType.OBJECT,
          properties: {
            destination: {
              type: FunctionDeclarationSchemaType.STRING,
              description: "The destination city and country, e.g., 'Paris, France'"
            },
            start_date: {
              type: FunctionDeclarationSchemaType.STRING,
              description: "Trip start date in YYYY-MM-DD format"
            },
            end_date: {
              type: FunctionDeclarationSchemaType.STRING,
              description: "Trip end date in YYYY-MM-DD format"
            },
            budget_tier: {
              type: FunctionDeclarationSchemaType.STRING,
              enum: ["budget", "balanced", "premium"],
              description: "Budget preference: budget (<$100/day), balanced ($100-250/day), premium ($250+/day)"
            },
            pace: {
              type: FunctionDeclarationSchemaType.STRING,
              enum: ["relaxed", "moderate", "active"],
              description: "Travel pace preference"
            },
            interests: {
              type: FunctionDeclarationSchemaType.ARRAY,
              items: { type: FunctionDeclarationSchemaType.STRING },
              description: "List of interests like culture, food, nature, adventure, history"
            }
          },
          required: ["destination", "start_date", "end_date"]
        }
      },
      {
        name: "search_destination",
        description: "Search for information about a destination including weather, best time to visit, and overview",
        parameters: {
          type: FunctionDeclarationSchemaType.OBJECT,
          properties: {
            query: {
              type: FunctionDeclarationSchemaType.STRING,
              description: "The destination to search for"
            }
          },
          required: ["query"]
        }
      },
      {
        name: "get_activities",
        description: "Get specific activity recommendations for a destination",
        parameters: {
          type: FunctionDeclarationSchemaType.OBJECT,
          properties: {
            destination: {
              type: FunctionDeclarationSchemaType.STRING,
              description: "The destination"
            },
            activity_type: {
              type: FunctionDeclarationSchemaType.STRING,
              enum: ["outdoor", "cultural", "culinary", "adventure", "relaxation", "nightlife", "shopping", "historical"],
              description: "Type of activity to search for"
            },
            count: {
              type: FunctionDeclarationSchemaType.NUMBER,
              description: "Number of activities to return (default 5)"
            }
          },
          required: ["destination"]
        }
      },
      {
        name: "get_booking_links",
        description: "Get affiliate booking links for flights, hotels, or activities",
        parameters: {
          type: FunctionDeclarationSchemaType.OBJECT,
          properties: {
            type: {
              type: FunctionDeclarationSchemaType.STRING,
              enum: ["flight", "hotel", "activity"],
              description: "Type of booking"
            },
            destination: {
              type: FunctionDeclarationSchemaType.STRING,
              description: "Destination for the booking"
            },
            dates: {
              type: FunctionDeclarationSchemaType.OBJECT,
              properties: {
                checkin: { type: FunctionDeclarationSchemaType.STRING },
                checkout: { type: FunctionDeclarationSchemaType.STRING }
              }
            }
          },
          required: ["type", "destination"]
        }
      }
    ]
  }
];
```

---

## System Prompt

The core system prompt that defines the AI's behavior:

```
You are MonkeyTravel AI, an expert travel planner with deep knowledge of destinations worldwide. Your role is to create personalized, practical, and memorable travel itineraries.

## Your Expertise
- Local knowledge of popular and hidden gem destinations
- Understanding of travel logistics (opening hours, travel times, seasonal variations)
- Budget optimization across different spending tiers
- Cultural sensitivity and local customs awareness
- Safety considerations and travel advisories

## Core Rules

1. **Real Places Only**: Only suggest real, verifiable locations. Never invent fictional places, restaurants, or attractions.

2. **Practical Scheduling**:
   - Consider opening hours and typical visit durations
   - Include buffer time for travel between locations
   - Schedule meals at appropriate times (breakfast 7-9, lunch 12-14, dinner 18-21)
   - Don't over-schedule - include rest time

3. **Budget Alignment**:
   - Budget Tier: Focus on free attractions, street food, public transport. Target <$100/day
   - Balanced Tier: Mix of paid attractions and local experiences. Target $100-250/day
   - Premium Tier: Skip-the-line access, fine dining, private tours. Target $250+/day

4. **Geographic Efficiency**:
   - Group nearby activities together
   - Minimize unnecessary backtracking
   - Consider traffic patterns for the destination

5. **Local Experience**:
   - Include at least 1-2 local gems per day (not just tourist attractions)
   - Suggest authentic local restaurants over tourist traps
   - Include cultural tips and local etiquette

6. **Weather & Seasonality**:
   - Consider weather conditions for the travel dates
   - Adjust outdoor activities based on season
   - Suggest indoor alternatives for rainy days

## Output Format

Always respond with valid JSON matching this schema exactly. Do not include any text before or after the JSON.
```

---

## User Prompt Template

```typescript
export function buildUserPrompt(params: {
  destination: string;
  startDate: string;
  endDate: string;
  duration: number;
  budgetTier: "budget" | "balanced" | "premium";
  pace: "relaxed" | "moderate" | "active";
  interests: string[];
  requirements?: string;
}): string {
  return `
Plan a ${params.duration}-day trip to ${params.destination}.

## Travel Details
- Dates: ${params.startDate} to ${params.endDate}
- Duration: ${params.duration} days
- Budget Tier: ${params.budgetTier}
- Travel Pace: ${params.pace}

## Traveler Preferences
- Interests: ${params.interests.join(", ")}
${params.requirements ? `- Special Requirements: ${params.requirements}` : ""}

## Required Output

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
      "theme": "Day theme (e.g., 'Historic Center')",
      "activities": [
        {
          "time_slot": "morning|afternoon|evening",
          "start_time": "HH:MM",
          "duration_minutes": 120,
          "name": "Activity Name",
          "type": "attraction|restaurant|activity|transport",
          "description": "What to do here",
          "location": "Address or area",
          "estimated_cost": {
            "amount": 25,
            "currency": "EUR",
            "tier": "free|budget|moderate|expensive"
          },
          "tips": ["Tip 1", "Tip 2"],
          "booking_required": false
        }
      ],
      "daily_budget": {
        "total": 150,
        "breakdown": {
          "activities": 50,
          "food": 60,
          "transport": 40
        }
      }
    }
  ],
  "trip_summary": {
    "total_estimated_cost": 450,
    "currency": "EUR",
    "highlights": ["Highlight 1", "Highlight 2"],
    "packing_suggestions": ["Item 1", "Item 2"]
  }
}

Important: Return ONLY the JSON object, no additional text or markdown.
`;
}
```

---

## Response Schema (TypeScript)

```typescript
// types/itinerary.ts

export interface GeneratedItinerary {
  destination: DestinationInfo;
  days: ItineraryDay[];
  trip_summary: TripSummary;
}

export interface DestinationInfo {
  name: string;
  country: string;
  description: string;
  best_for: string[];
  weather_note: string;
}

export interface ItineraryDay {
  day_number: number;
  date: string;
  theme: string;
  activities: Activity[];
  daily_budget: DailyBudget;
}

export interface Activity {
  time_slot: "morning" | "afternoon" | "evening";
  start_time: string;
  duration_minutes: number;
  name: string;
  type: "attraction" | "restaurant" | "activity" | "transport";
  description: string;
  location: string;
  estimated_cost: {
    amount: number;
    currency: string;
    tier: "free" | "budget" | "moderate" | "expensive";
  };
  tips: string[];
  booking_required: boolean;
}

export interface DailyBudget {
  total: number;
  breakdown: {
    activities: number;
    food: number;
    transport: number;
  };
}

export interface TripSummary {
  total_estimated_cost: number;
  currency: string;
  highlights: string[];
  packing_suggestions: string[];
}
```

---

## API Route Implementation

```typescript
// app/api/ai/generate/route.ts

import { NextRequest, NextResponse } from "next/server";
import { getModel } from "@/lib/gemini";
import { buildUserPrompt } from "@/lib/prompts";
import { validateInput, sanitizeInput } from "@/lib/security";
import { checkRateLimit, logRequest } from "@/lib/rate-limit";
import { supabase } from "@/lib/supabase";

const SYSTEM_PROMPT = `[System prompt from above]`;

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // 1. Parse and validate input
    const body = await request.json();
    const validation = validateInput(body);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 }
      );
    }

    // 2. Sanitize input for prompt injection
    const sanitized = sanitizeInput(body);

    // 3. Check rate limits
    const userId = request.headers.get("x-user-id") || "demo";
    const rateCheck = await checkRateLimit(userId);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded", retryAfter: rateCheck.retryAfter },
        { status: 429 }
      );
    }

    // 4. Build prompt and generate
    const userPrompt = buildUserPrompt(sanitized);
    const model = getModel();

    const chat = model.startChat({
      history: [
        { role: "user", parts: [{ text: SYSTEM_PROMPT }] },
        { role: "model", parts: [{ text: "Understood. I will generate travel itineraries following these rules." }] },
      ],
    });

    const result = await chat.sendMessage(userPrompt);
    const response = result.response;
    const text = response.text();

    // 5. Parse and validate JSON response
    let itinerary;
    try {
      itinerary = JSON.parse(text);
    } catch {
      throw new Error("AI returned invalid JSON");
    }

    // 6. Log the request
    const generationTime = Date.now() - startTime;
    await logRequest({
      userId,
      destination: sanitized.destination,
      duration: sanitized.duration,
      tokensUsed: response.usageMetadata?.totalTokenCount || 0,
      generationTimeMs: generationTime,
      status: "success",
    });

    return NextResponse.json({
      success: true,
      itinerary,
      meta: {
        generationTimeMs: generationTime,
        model: "gemini-2.0-flash-exp",
      },
    });

  } catch (error) {
    console.error("Generation error:", error);

    await logRequest({
      userId: request.headers.get("x-user-id") || "demo",
      destination: "unknown",
      duration: 0,
      tokensUsed: 0,
      generationTimeMs: Date.now() - startTime,
      status: "error",
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    });

    return NextResponse.json(
      { error: "Failed to generate itinerary" },
      { status: 500 }
    );
  }
}
```

---

## Input Validation & Security

```typescript
// lib/security.ts

const DESTINATION_BLACKLIST = [
  "<script>", "javascript:", "eval(", "SELECT ", "DROP ", "INSERT ",
  "DELETE ", "--", "/*", "*/", "UNION ", "OR 1=1",
];

const PROMPT_INJECTION_PATTERNS = [
  /ignore previous instructions/gi,
  /disregard all prior/gi,
  /you are now/gi,
  /pretend to be/gi,
  /system prompt/gi,
  /\[INST\]/gi,
  /<<SYS>>/gi,
  /new persona/gi,
  /override your/gi,
  /forget everything/gi,
];

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validateInput(input: unknown): ValidationResult {
  if (!input || typeof input !== "object") {
    return { valid: false, error: "Invalid request body" };
  }

  const body = input as Record<string, unknown>;

  // Required fields
  if (!body.destination || typeof body.destination !== "string") {
    return { valid: false, error: "Destination is required" };
  }

  if (!body.startDate || !body.endDate) {
    return { valid: false, error: "Travel dates are required" };
  }

  // Destination length
  if (body.destination.length > 100) {
    return { valid: false, error: "Destination name too long" };
  }

  // Check for blacklisted content
  const destLower = body.destination.toLowerCase();
  for (const blocked of DESTINATION_BLACKLIST) {
    if (destLower.includes(blocked.toLowerCase())) {
      return { valid: false, error: "Invalid characters in destination" };
    }
  }

  // Check for prompt injection
  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    if (pattern.test(body.destination)) {
      return { valid: false, error: "Invalid input detected" };
    }
  }

  // Date validation
  const start = new Date(body.startDate as string);
  const end = new Date(body.endDate as string);
  const now = new Date();

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return { valid: false, error: "Invalid date format" };
  }

  if (start < now) {
    return { valid: false, error: "Start date cannot be in the past" };
  }

  if (end <= start) {
    return { valid: false, error: "End date must be after start date" };
  }

  const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  if (days > 7) {
    return { valid: false, error: "Maximum trip duration is 7 days" };
  }

  // Budget tier validation
  const validTiers = ["budget", "balanced", "premium"];
  if (body.budgetTier && !validTiers.includes(body.budgetTier as string)) {
    return { valid: false, error: "Invalid budget tier" };
  }

  // Interests validation
  if (body.interests && Array.isArray(body.interests)) {
    if (body.interests.length > 10) {
      return { valid: false, error: "Maximum 10 interests allowed" };
    }
  }

  return { valid: true };
}

export function sanitizeInput(body: Record<string, unknown>) {
  return {
    destination: sanitizeString(body.destination as string),
    startDate: body.startDate as string,
    endDate: body.endDate as string,
    duration: calculateDuration(body.startDate as string, body.endDate as string),
    budgetTier: (body.budgetTier as string) || "balanced",
    pace: (body.pace as string) || "moderate",
    interests: sanitizeArray(body.interests as string[]),
    requirements: body.requirements ? sanitizeString(body.requirements as string) : undefined,
  };
}

function sanitizeString(input: string): string {
  let sanitized = input.trim().slice(0, 200);

  // Remove prompt injection attempts
  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    sanitized = sanitized.replace(pattern, "");
  }

  // Remove special characters that could be used for injection
  sanitized = sanitized.replace(/[<>{}[\]\\]/g, "");

  return sanitized;
}

function sanitizeArray(input: string[] | undefined): string[] {
  if (!input || !Array.isArray(input)) return [];
  return input
    .slice(0, 10)
    .map((item) => sanitizeString(item))
    .filter((item) => item.length > 0 && item.length <= 50);
}

function calculateDuration(start: string, end: string): number {
  const startDate = new Date(start);
  const endDate = new Date(end);
  return Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
}
```

---

## Rate Limiting

```typescript
// lib/rate-limit.ts

import { supabase } from "./supabase";

const LIMITS = {
  demo: {
    requestsPerHour: 3,
    requestsPerDay: 5,
  },
  authenticated: {
    requestsPerHour: 10,
    requestsPerDay: 25,
  },
  global: {
    requestsPerHour: 100,
    maxDailyCostUSD: 50,
  },
};

export async function checkRateLimit(
  userId: string
): Promise<{ allowed: boolean; retryAfter?: number }> {
  const isDemo = userId === "demo" || userId.startsWith("demo-");
  const limits = isDemo ? LIMITS.demo : LIMITS.authenticated;

  const now = new Date();
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // Check user's hourly limit
  const { count: hourlyCount } = await supabase
    .from("api_request_logs")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("api_name", "gemini")
    .gte("created_at", hourAgo.toISOString());

  if ((hourlyCount || 0) >= limits.requestsPerHour) {
    return { allowed: false, retryAfter: 60 };
  }

  // Check user's daily limit
  const { count: dailyCount } = await supabase
    .from("api_request_logs")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("api_name", "gemini")
    .gte("created_at", dayAgo.toISOString());

  if ((dailyCount || 0) >= limits.requestsPerDay) {
    return { allowed: false, retryAfter: 3600 };
  }

  // Check global hourly limit
  const { count: globalCount } = await supabase
    .from("api_request_logs")
    .select("*", { count: "exact", head: true })
    .eq("api_name", "gemini")
    .gte("created_at", hourAgo.toISOString());

  if ((globalCount || 0) >= LIMITS.global.requestsPerHour) {
    return { allowed: false, retryAfter: 300 };
  }

  return { allowed: true };
}

export async function logRequest(params: {
  userId: string;
  destination: string;
  duration: number;
  tokensUsed: number;
  generationTimeMs: number;
  status: string;
  errorMessage?: string;
}) {
  // Estimate cost (Gemini pricing)
  const estimatedCost = (params.tokensUsed / 1_000_000) * 10; // ~$10/1M tokens average

  await supabase.from("api_request_logs").insert({
    api_name: "gemini",
    endpoint: "/api/ai/generate",
    user_id: params.userId,
    request_params: {
      destination: params.destination,
      duration: params.duration,
    },
    response_time_ms: params.generationTimeMs,
    tokens_used: params.tokensUsed,
    estimated_cost_usd: estimatedCost,
    status: params.status,
    error_message: params.errorMessage,
    created_at: new Date().toISOString(),
  });
}
```

---

## Usage Example

```typescript
// Example: Client-side hook for generating itinerary

import { useState } from "react";
import { GeneratedItinerary } from "@/types/itinerary";

export function useGenerateItinerary() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [itinerary, setItinerary] = useState<GeneratedItinerary | null>(null);

  async function generate(params: {
    destination: string;
    startDate: string;
    endDate: string;
    budgetTier: "budget" | "balanced" | "premium";
    pace: "relaxed" | "moderate" | "active";
    interests: string[];
    requirements?: string;
  }) {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Generation failed");
      }

      setItinerary(data.itinerary);
      return data.itinerary;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }

  return { generate, loading, error, itinerary };
}
```

---

## Testing the Integration

```typescript
// Test script for Gemini integration

async function testGeneration() {
  const testParams = {
    destination: "Paris, France",
    startDate: "2025-02-01",
    endDate: "2025-02-03",
    budgetTier: "balanced",
    pace: "moderate",
    interests: ["culture", "food", "history"],
  };

  console.log("Testing itinerary generation...");
  console.log("Params:", testParams);

  const response = await fetch("/api/ai/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(testParams),
  });

  const data = await response.json();

  if (data.success) {
    console.log("Success!");
    console.log("Generation time:", data.meta.generationTimeMs, "ms");
    console.log("Days generated:", data.itinerary.days.length);
    console.log("Total cost:", data.itinerary.trip_summary.total_estimated_cost);
  } else {
    console.error("Failed:", data.error);
  }
}
```

---

## Dependencies

Add these to your project:

```bash
npm install @google/generative-ai
```

Environment variables required:
```env
GOOGLE_AI_API_KEY=your-gemini-api-key
```

---

*Skill Version: 1.0*
*Compatible with: Next.js 14+, Gemini API*
