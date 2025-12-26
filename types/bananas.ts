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
  | 'trip_complete'   // Earned from completing a trip
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
// REDEMPTION CATALOG
// =============================================================================

export type RedemptionCategory = 'feature' | 'partner' | 'subscription';

export interface RedemptionItem {
  id: string;
  name: string;
  description?: string;
  iconUrl?: string;        // Emoji or image URL
  category: RedemptionCategory;
  bananaCost: number;
  isActive: boolean;
  availableFrom?: string;
  availableUntil?: string;
  stockLimit?: number;
  stockRemaining?: number;
  perUserLimit?: number;
  cooldownHours?: number;
  sortOrder: number;

  // For partner items (future)
  partnerId?: string;
  discountType?: 'percentage' | 'fixed' | 'upgrade';
  discountValue?: number;
}

export interface UserRedemption {
  id: string;
  userId: string;
  catalogItemId: string;
  catalogItem: RedemptionItem;
  bananasSpent: number;
  status: 'pending' | 'fulfilled' | 'expired' | 'refunded';
  fulfilledAt?: string;
  expiresAt?: string;
  partnerReference?: string;
  createdAt: string;
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

export interface RedeemResponse {
  success: boolean;
  redemption?: UserRedemption;
  newBalance: number;
  error?: string;
  errorCode?: 'INSUFFICIENT_BALANCE' | 'OUT_OF_STOCK' | 'LIMIT_REACHED' | 'COOLDOWN_ACTIVE';
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

export interface RedemptionCatalogRow {
  id: string;
  name: string;
  description: string | null;
  icon_url: string | null;
  category: RedemptionCategory;
  banana_cost: number;
  is_active: boolean;
  available_from: string | null;
  available_until: string | null;
  stock_limit: number | null;
  stock_used: number;
  per_user_limit: number | null;
  cooldown_hours: number | null;
  partner_id: string | null;
  partner_config: Record<string, unknown>;
  discount_type: 'percentage' | 'fixed' | 'upgrade' | null;
  discount_value: number | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface BananaRedemptionRow {
  id: string;
  user_id: string;
  catalog_item_id: string;
  bananas_spent: number;
  status: 'pending' | 'fulfilled' | 'expired' | 'refunded';
  fulfilled_at: string | null;
  expires_at: string | null;
  partner_reference: string | null;
  partner_response: Record<string, unknown>;
  created_at: string;
}

// =============================================================================
// CONVERSION UTILITIES
// =============================================================================

export function transactionRowToApi(row: BananaTransactionRow): BananaTransaction {
  return {
    id: row.id,
    userId: row.user_id,
    amount: row.amount,
    balanceAfter: row.balance_after,
    transactionType: row.transaction_type,
    referenceId: row.reference_id ?? undefined,
    description: row.description ?? undefined,
    expiresAt: row.expires_at ?? undefined,
    expired: row.expired,
    createdAt: row.created_at,
  };
}

export function catalogRowToApi(row: RedemptionCatalogRow): RedemptionItem {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    iconUrl: row.icon_url ?? undefined,
    category: row.category,
    bananaCost: row.banana_cost,
    isActive: row.is_active,
    availableFrom: row.available_from ?? undefined,
    availableUntil: row.available_until ?? undefined,
    stockLimit: row.stock_limit ?? undefined,
    stockRemaining: row.stock_limit ? row.stock_limit - row.stock_used : undefined,
    perUserLimit: row.per_user_limit ?? undefined,
    cooldownHours: row.cooldown_hours ?? undefined,
    sortOrder: row.sort_order,
    partnerId: row.partner_id ?? undefined,
    discountType: row.discount_type ?? undefined,
    discountValue: row.discount_value ?? undefined,
  };
}
