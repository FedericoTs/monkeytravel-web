/**
 * AI Model Configuration and Tiering System
 *
 * This module defines the model tiers, costs, and selection logic
 * for the AI assistant system. It implements best practices for
 * cost optimization by using appropriate models for different tasks.
 */

// Model tier definitions
export type ModelTier = "fast" | "standard" | "powerful";

export interface ModelConfig {
  id: string;
  name: string;
  tier: ModelTier;
  costPer1kTokens: number; // in USD cents
  maxTokens: number;
  supportsStreaming: boolean;
  bestFor: string[];
}

// Available models with their configurations
// Updated to Gemini 2.5 for implicit caching (75-90% token discount)
// Note: Costs shown are BASE costs; cached tokens get 75% discount automatically
// See: https://developers.googleblog.com/en/gemini-2-5-models-now-support-implicit-caching/
export const MODELS: Record<string, ModelConfig> = {
  // Fast tier - for quick, simple tasks
  // Base: $0.10/1K input, $0.40/1K output
  // With implicit caching: ~$0.025/1K input (75% discount on repeated prompts)
  "gemini-2.5-flash-lite": {
    id: "gemini-2.5-flash-lite",
    name: "Gemini 2.5 Flash Lite",
    tier: "fast",
    costPer1kTokens: 0.10, // Base cost (effective ~0.025 with caching)
    maxTokens: 8192,
    supportsStreaming: true,
    bestFor: ["quick_answers", "clarifications", "simple_edits", "formatting"],
  },

  // Standard tier - for most tasks
  // Base: $0.30/1K input, $2.50/1K output
  // With implicit caching: ~$0.075/1K input (75% discount on repeated prompts)
  "gemini-2.5-flash": {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    tier: "standard",
    costPer1kTokens: 0.30, // Base cost (effective ~0.075 with caching)
    maxTokens: 8192,
    supportsStreaming: true,
    bestFor: ["activity_suggestions", "single_regeneration", "tips", "recommendations"],
  },

  // Powerful tier - for complex tasks
  // Base: $1.25/1K input (≤200K), $10/1K output
  // With implicit caching: ~$0.31/1K input (75% discount on repeated prompts)
  "gemini-2.5-pro": {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    tier: "powerful",
    costPer1kTokens: 1.25, // Base cost (effective ~0.31 with caching)
    maxTokens: 8192,
    supportsStreaming: true,
    bestFor: ["full_itinerary", "complex_redesign", "multi_day_planning", "deep_research"],
  },
};

// Task complexity classification
export type TaskComplexity = "simple" | "medium" | "complex";

export interface TaskClassification {
  complexity: TaskComplexity;
  recommendedTier: ModelTier;
  estimatedTokens: number;
  requiresContext: boolean;
}

// Keywords and patterns for task classification
const SIMPLE_PATTERNS = [
  /what time/i,
  /how long/i,
  /where is/i,
  /cost of/i,
  /price/i,
  /address/i,
  /phone/i,
  /hours/i,
  /open/i,
  /close/i,
  /weather/i,
  /currency/i,
  /tip/i,
  /quick/i,
];

const COMPLEX_PATTERNS = [
  /redesign/i,
  /replan/i,
  /completely/i,
  /entire/i,
  /all days/i,
  /whole trip/i,
  /from scratch/i,
  /overhaul/i,
  /major change/i,
  /new itinerary/i,
  /different approach/i,
];

const MEDIUM_PATTERNS = [
  /suggest/i,
  /recommend/i,
  /alternative/i,
  /replace/i,
  /change/i,
  /add/i,
  /remove/i,
  /move/i,
  /swap/i,
  /different/i,
];

/**
 * Classify a user message to determine task complexity
 */
export function classifyTask(message: string, contextLength: number = 0): TaskClassification {
  const lowerMessage = message.toLowerCase();
  const wordCount = message.split(/\s+/).length;

  // Check for complex patterns first
  if (COMPLEX_PATTERNS.some((p) => p.test(message))) {
    return {
      complexity: "complex",
      recommendedTier: "powerful",
      estimatedTokens: Math.max(2000, contextLength + wordCount * 10),
      requiresContext: true,
    };
  }

  // Check for simple patterns
  if (SIMPLE_PATTERNS.some((p) => p.test(message)) && wordCount < 20) {
    return {
      complexity: "simple",
      recommendedTier: "fast",
      estimatedTokens: Math.max(500, contextLength + wordCount * 5),
      requiresContext: false,
    };
  }

  // Check for medium patterns
  if (MEDIUM_PATTERNS.some((p) => p.test(message))) {
    return {
      complexity: "medium",
      recommendedTier: "standard",
      estimatedTokens: Math.max(1000, contextLength + wordCount * 8),
      requiresContext: true,
    };
  }

  // Default to medium for unknown tasks
  return {
    complexity: "medium",
    recommendedTier: "standard",
    estimatedTokens: Math.max(1000, contextLength + wordCount * 8),
    requiresContext: true,
  };
}

/**
 * Select the best model for a given task
 */
export function selectModel(classification: TaskClassification): ModelConfig {
  const tierModels = Object.values(MODELS).filter(
    (m) => m.tier === classification.recommendedTier
  );

  // Return the first matching model for the tier
  return tierModels[0] || MODELS["gemini-2.5-flash"];
}

/**
 * Estimate cost for a task
 */
export function estimateCost(
  model: ModelConfig,
  inputTokens: number,
  outputTokens: number
): number {
  const totalTokens = inputTokens + outputTokens;
  return (totalTokens / 1000) * model.costPer1kTokens;
}

// Rate limiting configuration
export interface RateLimitConfig {
  maxRequestsPerMinute: number;
  maxRequestsPerHour: number;
  maxTokensPerDay: number;
  cooldownMinutes: number;
}

export const RATE_LIMITS: Record<string, RateLimitConfig> = {
  free: {
    maxRequestsPerMinute: 5,
    maxRequestsPerHour: 30,
    maxTokensPerDay: 50000,
    cooldownMinutes: 1,
  },
  premium: {
    maxRequestsPerMinute: 20,
    maxRequestsPerHour: 200,
    maxTokensPerDay: 500000,
    cooldownMinutes: 0,
  },
};

// Action types the AI assistant can perform
export type AssistantAction =
  | "answer_question"
  | "suggest_activity"
  | "edit_activity"
  | "add_activity"
  | "remove_activity"
  | "move_activity"
  | "regenerate_activity"
  | "reorder_day"
  | "swap_days"
  | "optimize_budget"
  | "suggest_alternatives"
  | "full_redesign"
  | "explain"
  | "tips";

// Action to tier mapping for forced tier selection
export const ACTION_TIERS: Record<AssistantAction, ModelTier> = {
  answer_question: "fast",
  explain: "fast",
  tips: "fast",
  suggest_activity: "standard",
  edit_activity: "standard",
  add_activity: "standard",
  remove_activity: "fast",
  move_activity: "fast",
  regenerate_activity: "standard",
  reorder_day: "standard",
  swap_days: "fast",
  optimize_budget: "standard",
  suggest_alternatives: "standard",
  full_redesign: "powerful",
};
