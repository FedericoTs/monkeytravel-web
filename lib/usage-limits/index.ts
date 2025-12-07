/**
 * Usage Limits Module
 *
 * Provides centralized usage limit tracking for AI generation and Places API.
 * Supports tiered limits (free/premium) with monthly and daily periods.
 *
 * Usage:
 * ```typescript
 * import { checkUsageLimit, incrementUsage, getUserUsageStats } from '@/lib/usage-limits';
 *
 * // Check if user can perform action
 * const check = await checkUsageLimit(userId, 'aiGenerations', 'monthly');
 * if (!check.allowed) {
 *   return { error: check.message, usage: check };
 * }
 *
 * // After successful action, increment counter
 * await incrementUsage(userId, 'aiGenerations');
 * ```
 */

export * from "./types";
export * from "./config";
export * from "./check";
