/**
 * Bananas Currency System Types
 *
 * Types for the referral reward system with banana currency,
 * tier progression, and redemption catalog.
 */

// =============================================================================
// BANANA TRANSACTIONS
// =============================================================================

export type BananaTransactionType =
  | 'referral'        // Earned from successful referral
  | 'tier_bonus'      // One-time tier unlock bonus
  | 'trip_complete'   // Earned from completing a trip (all activities done)
  | 'activity_completion' // Retired live-trip reward per check-off; old ledger rows keep it
  | 'achievement_bonus'   // Retired live-trip achievement reward; old ledger rows keep it
  | 'first_trip_bonus'    // One-time bonus on the user's first ever trip completion
  | 'signup_bonus'    // New user signup bonus
  | 'review'          // Earned from leaving a review
  | 'collaboration'   // Earned from collaborator referral
  | 'spend'           // Spent on redemption
  | 'clawback'        // Reversed due to fraud
  | 'expiration'      // Expired after 12 months
  | 'admin';          // Manual admin adjustment

export interface BananaTransaction {
  id: string;
  userId: string;
  amount: number;          // Positive = earn, Negative = spend
  balanceAfter: number;
  transactionType: BananaTransactionType;
  referenceId?: string;
  description?: string;
  expiresAt?: string;      // ISO date string
  expired: boolean;
  createdAt: string;
}

export interface BananaBalanceInfo {
  available: number;       // Current spendable balance
  expiringSoon: number;    // Amount expiring in next 30 days
  expiringDate?: string;   // When the soonest expiration is
  lifetimeEarned: number;  // Total ever earned
  lifetimeSpent: number;   // Total ever spent
}

// =============================================================================
// REFERRAL TIERS
// =============================================================================

export type ReferralTierLevel = 0 | 1 | 2 | 3;

export interface ReferralTierInfo {
  currentTier: ReferralTierLevel;
  highestTierAchieved: ReferralTierLevel;  // For permanent badges
  lifetimeConversions: number;
  conversionsToNextTier: number;           // 0 if at max tier
  nextTierAt: number;                      // Conversion count needed
  tier1UnlockedAt?: string;
  tier2UnlockedAt?: string;
  tier3UnlockedAt?: string;
}

export interface TierBadgeInfo {
  tier: ReferralTierLevel;
  name: string;           // "Explorer", "Ambassador", "Champion"
  emoji: string;          // "🌟", "🔥", "👑"
  unlocked: boolean;
  unlockedAt?: string;
}

export interface TierBenefits {
  aiGenerationsBonus: number;
  aiRegenerationsBonus: number;
  bananasPerReferral: number;
  tierBonus: number;
  hasTemplateAccess: boolean;
  templateCount: number;
  hasPrioritySupport: boolean;
  hasEarlyAccess: boolean;
}

// =============================================================================
// LEADERBOARD
// =============================================================================

export type LeaderboardVisibility = 'full' | 'initials' | 'anonymous';
export type LeaderboardPeriod = 'monthly' | 'alltime';

export interface LeaderboardEntry {
  rank: number;
  displayName: string;     // Anonymized based on visibility preference
  avatarUrl?: string;      // Hidden if anonymous
  badge: TierBadgeInfo | null;
  referralCount: number;
  isCurrentUser: boolean;
}

export interface LeaderboardResponse {
  period: LeaderboardPeriod;
  entries: LeaderboardEntry[];
  userRank: number | null;        // Current user's rank (even if not in top N)
  totalParticipants: number;
  updatedAt: string;
}

// =============================================================================
// API RESPONSES
// =============================================================================

export interface BananasDashboardResponse {
  balance: BananaBalanceInfo;
  tier: ReferralTierInfo;
  badges: TierBadgeInfo[];
  recentTransactions: BananaTransaction[];
  referralStats: {
    totalReferrals: number;
    pendingReferrals: number;
    bananasEarned: number;
  };
}

// =============================================================================
// DATABASE ROW TYPES (snake_case for Supabase)
// =============================================================================

export interface BananaTransactionRow {
  id: string;
  user_id: string;
  amount: number;
  balance_after: number;
  transaction_type: BananaTransactionType;
  reference_id: string | null;
  description: string | null;
  expires_at: string | null;
  expired: boolean;
  created_at: string;
}

export interface ReferralTierRow {
  id: string;
  user_id: string;
  current_tier: number;
  tier_1_unlocked_at: string | null;
  tier_2_unlocked_at: string | null;
  tier_3_unlocked_at: string | null;
  lifetime_conversions: number;
  highest_tier_achieved: number;
  updated_at: string;
}
