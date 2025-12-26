/**
 * Referral System
 *
 * Handles referral tracking, completion, and rewards.
 *
 * Server-side (API routes):
 * - completeReferralIfEligible
 * - isEligibleForFirstTripReward
 *
 * Client-side (React components):
 * - completeReferral
 * - handleTripCreatedWithReferral
 * - mightBeEligibleForReferralReward
 */

// Server-side exports (for API routes)
export {
  completeReferralIfEligible,
  isEligibleForFirstTripReward,
  type ReferralCompletionResult,
} from "./completion";

// Note: Client-side exports are in client.ts and must be imported separately
// to avoid "use client" conflicts in server code.
// Import from "@/lib/referral/client" for client-side usage.
