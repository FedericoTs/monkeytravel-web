/**
 * AI Usage Tracking and Rate Limiting
 *
 * This module handles tracking AI usage per user/trip,
 * enforcing rate limits, and providing usage analytics.
 */

import { createClient } from "@/lib/supabase/server";
import { RATE_LIMITS, type RateLimitConfig } from "./config";

export interface UsageRecord {
  id: string;
  user_id: string;
  trip_id?: string;
  model_id: string;
  action: string;
  input_tokens: number;
  output_tokens: number;
  cost_cents: number;
  created_at: string;
}

export interface UsageStats {
  requestsLastMinute: number;
  requestsLastHour: number;
  tokensToday: number;
  totalCostToday: number;
  isRateLimited: boolean;
  cooldownEndsAt?: string;
  remainingRequests: number;
  remainingTokens: number;
}

/**
 * Check if a user is rate limited
 */
export async function checkRateLimit(
  userId: string,
  userTier: "free" | "premium" = "free"
): Promise<{ allowed: boolean; stats: UsageStats; message?: string }> {
  const supabase = await createClient();
  const limits = RATE_LIMITS[userTier];
  const now = new Date();

  // Get usage from last minute
  const minuteAgo = new Date(now.getTime() - 60 * 1000).toISOString();
  const { count: requestsLastMinute } = await supabase
    .from("ai_usage")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", minuteAgo);

  // Get usage from last hour
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const { count: requestsLastHour } = await supabase
    .from("ai_usage")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", hourAgo);

  // Get usage from today (tokens and cost)
  const todayStart = new Date(now.setHours(0, 0, 0, 0)).toISOString();
  const { data: todayUsage } = await supabase
    .from("ai_usage")
    .select("input_tokens, output_tokens, cost_cents")
    .eq("user_id", userId)
    .gte("created_at", todayStart);

  const tokensToday = todayUsage?.reduce(
    (sum, r) => sum + (r.input_tokens || 0) + (r.output_tokens || 0),
    0
  ) || 0;

  const totalCostToday = todayUsage?.reduce(
    (sum, r) => sum + (r.cost_cents || 0),
    0
  ) || 0;

  // Check rate limits
  const minuteCount = requestsLastMinute || 0;
  const hourCount = requestsLastHour || 0;

  let isRateLimited = false;
  let message: string | undefined;

  if (minuteCount >= limits.maxRequestsPerMinute) {
    isRateLimited = true;
    message = `Rate limit reached. Please wait ${limits.cooldownMinutes || 1} minute(s).`;
  } else if (hourCount >= limits.maxRequestsPerHour) {
    isRateLimited = true;
    message = "Hourly limit reached. Please try again later.";
  } else if (tokensToday >= limits.maxTokensPerDay) {
    isRateLimited = true;
    message = "Daily token limit reached. Limits reset at midnight.";
  }

  const stats: UsageStats = {
    requestsLastMinute: minuteCount,
    requestsLastHour: hourCount,
    tokensToday,
    totalCostToday: totalCostToday / 100, // Convert cents to dollars
    isRateLimited,
    remainingRequests: Math.max(0, limits.maxRequestsPerHour - hourCount),
    remainingTokens: Math.max(0, limits.maxTokensPerDay - tokensToday),
  };

  return { allowed: !isRateLimited, stats, message };
}

/**
 * Record AI usage for a request
 */
export async function recordUsage(params: {
  userId: string;
  tripId?: string;
  modelId: string;
  action: string;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
}): Promise<void> {
  const supabase = await createClient();

  await supabase.from("ai_usage").insert({
    user_id: params.userId,
    trip_id: params.tripId,
    model_id: params.modelId,
    action: params.action,
    input_tokens: params.inputTokens,
    output_tokens: params.outputTokens,
    cost_cents: params.costCents,
    created_at: new Date().toISOString(),
  });
}

/**
 * Get usage statistics for a user
 */
export async function getUserUsageStats(
  userId: string,
  days: number = 30
): Promise<{
  totalRequests: number;
  totalTokens: number;
  totalCost: number;
  byModel: Record<string, number>;
  byAction: Record<string, number>;
  daily: { date: string; requests: number; tokens: number }[];
}> {
  const supabase = await createClient();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const { data: usage } = await supabase
    .from("ai_usage")
    .select("*")
    .eq("user_id", userId)
    .gte("created_at", startDate.toISOString())
    .order("created_at", { ascending: true });

  if (!usage || usage.length === 0) {
    return {
      totalRequests: 0,
      totalTokens: 0,
      totalCost: 0,
      byModel: {},
      byAction: {},
      daily: [],
    };
  }

  const byModel: Record<string, number> = {};
  const byAction: Record<string, number> = {};
  const dailyMap: Record<string, { requests: number; tokens: number }> = {};

  let totalTokens = 0;
  let totalCost = 0;

  for (const record of usage) {
    const tokens = (record.input_tokens || 0) + (record.output_tokens || 0);
    totalTokens += tokens;
    totalCost += record.cost_cents || 0;

    byModel[record.model_id] = (byModel[record.model_id] || 0) + 1;
    byAction[record.action] = (byAction[record.action] || 0) + 1;

    const date = record.created_at.split("T")[0];
    if (!dailyMap[date]) {
      dailyMap[date] = { requests: 0, tokens: 0 };
    }
    dailyMap[date].requests++;
    dailyMap[date].tokens += tokens;
  }

  return {
    totalRequests: usage.length,
    totalTokens,
    totalCost: totalCost / 100,
    byModel,
    byAction,
    daily: Object.entries(dailyMap).map(([date, data]) => ({ date, ...data })),
  };
}

/**
 * Get trip-specific usage
 */
export async function getTripUsage(
  tripId: string
): Promise<{
  totalRequests: number;
  totalTokens: number;
  actions: { action: string; count: number }[];
}> {
  const supabase = await createClient();

  const { data: usage } = await supabase
    .from("ai_usage")
    .select("action, input_tokens, output_tokens")
    .eq("trip_id", tripId);

  if (!usage || usage.length === 0) {
    return { totalRequests: 0, totalTokens: 0, actions: [] };
  }

  const actionCounts: Record<string, number> = {};
  let totalTokens = 0;

  for (const record of usage) {
    totalTokens += (record.input_tokens || 0) + (record.output_tokens || 0);
    actionCounts[record.action] = (actionCounts[record.action] || 0) + 1;
  }

  return {
    totalRequests: usage.length,
    totalTokens,
    actions: Object.entries(actionCounts).map(([action, count]) => ({ action, count })),
  };
}
