/**
 * MCP Server Schema Definitions
 * Zod schemas for validating ChatGPT MCP requests
 *
 * IMPORTANT: This is a NEW file - does not modify existing code
 */

import { z } from "zod";

// ============================================================================
// INPUT SCHEMAS
// ============================================================================

/**
 * Schema for generate_trip tool input
 * Simplified version of TripCreationParams for MCP
 */
export const GenerateTripInputSchema = z.object({
  destination: z
    .string()
    .min(2, "Destination must be at least 2 characters")
    .max(100, "Destination too long")
    .transform((s) => s.trim()),

  days: z
    .number()
    .int("Days must be a whole number")
    .min(1, "Minimum 1 day")
    .max(14, "Maximum 14 days for MCP"),

  travel_style: z
    .enum([
      "adventure",
      "relaxation",
      "cultural",
      "foodie",
      "budget",
      "luxury",
      "romantic",
      "family",
    ])
    .optional(),

  interests: z
    .array(z.string().max(50))
    .max(5, "Maximum 5 interests")
    .optional(),

  budget: z.enum(["budget", "moderate", "luxury"]).optional(),
});

export type GenerateTripInput = z.infer<typeof GenerateTripInputSchema>;

// ============================================================================
// OUTPUT TYPES
// ============================================================================

/**
 * Simplified activity for MCP widget display
 */
export interface MCPActivity {
  name: string;
  time: string; // "09:00-11:00"
  type: string;
  description: string;
  location?: string;
  tip?: string;
}

/**
 * Simplified day for MCP widget display
 */
export interface MCPDay {
  day: number;
  theme: string;
  activities: MCPActivity[];
}

/**
 * MCP trip response structure
 */
export interface MCPTripResponse {
  id: string;
  destination: string;
  days: number;
  itinerary: MCPDay[];
  summary: string;
  saveUrl: string;
}

// ============================================================================
// MCP PROTOCOL SCHEMAS
// ============================================================================

/**
 * MCP tool definition for ChatGPT
 */
export const MCP_TOOL_DEFINITION = {
  name: "generate_trip",
  description:
    "Create a personalized day-by-day travel itinerary with activities, restaurants, and local experiences. Returns a visual itinerary widget.",
  inputSchema: {
    type: "object" as const,
    properties: {
      destination: {
        type: "string",
        description: "City or region to visit (e.g., 'Rome', 'Tokyo', 'Bali')",
      },
      days: {
        type: "number",
        description: "Number of days for the trip (1-14)",
      },
      travel_style: {
        type: "string",
        enum: [
          "adventure",
          "relaxation",
          "cultural",
          "foodie",
          "budget",
          "luxury",
          "romantic",
          "family",
        ],
        description: "Optional preferred travel style",
      },
      interests: {
        type: "array",
        items: { type: "string" },
        description: "Optional list of interests (max 5)",
      },
      budget: {
        type: "string",
        enum: ["budget", "moderate", "luxury"],
        description: "Optional budget level",
      },
    },
    required: ["destination", "days"],
  },
};
