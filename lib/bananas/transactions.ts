/**
 * Banana Transaction Operations
 *
 * Functions for adding, spending, and viewing banana transactions.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import type {
  BananaTransaction,
  BananaTransactionType,
  BananaTransactionRow,
  transactionRowToApi,
} from '@/types/bananas';
import { TIER_EARNING_MULTIPLIERS } from './config';
import type { ReferralTierLevel } from '@/types/bananas';

interface AddBananasResult {
  success: boolean;
  newBalance: number;
  transactionId: string | null;
  error?: string;
}

/**
 * Add bananas to user's account
 * Uses database function for atomic operation with 12-month expiration
 */
export async function addBananas(
  supabase: SupabaseClient,
  userId: string,
  amount: number,
  type: BananaTransactionType,
  referenceId?: string,
  description?: string
): Promise<AddBananasResult> {
  if (amount <= 0) {
    return {
      success: false,
      newBalance: 0,
      transactionId: null,
      error: 'Amount must be positive',
    };
  }

  const { data, error } = await supabase.rpc('add_bananas', {
    p_user_id: userId,
    p_amount: amount,
    p_type: type,
    p_reference_id: referenceId || null,
    p_description: description || null,
  });

  if (error) {
    console.error('Error adding bananas:', error);
    return {
      success: false,
      newBalance: 0,
      transactionId: null,
      error: error.message,
    };
  }

  const result = data?.[0];
  return {
    success: true,
    newBalance: result?.new_balance ?? 0,
    transactionId: result?.transaction_id ?? null,
  };
}

/**
 * Spend bananas from user's account
 * Uses FIFO (oldest expire first)
 */
export async function spendBananas(
  supabase: SupabaseClient,
  userId: string,
  amount: number,
  type: BananaTransactionType = 'spend',
  referenceId?: string,
  description?: string
): Promise<AddBananasResult> {
  if (amount <= 0) {
    return {
      success: false,
      newBalance: 0,
      transactionId: null,
      error: 'Amount must be positive',
    };
  }

  const { data, error } = await supabase.rpc('spend_bananas', {
    p_user_id: userId,
    p_amount: amount,
    p_type: type,
    p_reference_id: referenceId || null,
    p_description: description || null,
  });

  if (error) {
    console.error('Error spending bananas:', error);
    return {
      success: false,
      newBalance: 0,
      transactionId: null,
      error: error.message,
    };
  }

  const result = data?.[0];
  if (!result?.success) {
    return {
      success: false,
      newBalance: result?.new_balance ?? 0,
      transactionId: null,
      error: 'Insufficient balance',
    };
  }

  return {
    success: true,
    newBalance: result.new_balance,
    transactionId: result.transaction_id,
  };
}

/**
 * Get user's transaction history
 */
export async function getTransactionHistory(
  supabase: SupabaseClient,
  userId: string,
  limit: number = 20,
  offset: number = 0
): Promise<BananaTransaction[]> {
  const { data, error } = await supabase
    .from('banana_transactions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error('Error getting transaction history:', error);
    return [];
  }

  return (data as BananaTransactionRow[]).map(row => ({
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
  }));
}

/**
 * Add bananas for a referral with tier multiplier
 */
export async function addReferralBananas(
  supabase: SupabaseClient,
  userId: string,
  referralEventId: string,
  userTier: ReferralTierLevel = 0
): Promise<AddBananasResult> {
  const { BANANA_EARNING_RATES } = await import('./config');
  const baseAmount = BANANA_EARNING_RATES.referral;
  const multiplier = TIER_EARNING_MULTIPLIERS[userTier];
  const amount = Math.round(baseAmount * multiplier);

  return addBananas(
    supabase,
    userId,
    amount,
    'referral',
    referralEventId,
    `Referral reward (${userTier > 0 ? `Tier ${userTier} bonus` : 'Base rate'})`
  );
}

/**
 * Add bananas for a collaborator joining via invite
 */
export async function addCollaborationBananas(
  supabase: SupabaseClient,
  userId: string,
  inviteId: string,
  userTier: ReferralTierLevel = 0
): Promise<AddBananasResult> {
  const { BANANA_EARNING_RATES } = await import('./config');
  const baseAmount = BANANA_EARNING_RATES.collaboration;
  const multiplier = TIER_EARNING_MULTIPLIERS[userTier];
  const amount = Math.round(baseAmount * multiplier);

  return addBananas(
    supabase,
    userId,
    amount,
    'collaboration',
    inviteId,
    `Friend joined your trip${userTier > 0 ? ` (Tier ${userTier} bonus)` : ''}`
  );
}

/**
 * Add tier unlock bonus
 */
export async function addTierBonus(
  supabase: SupabaseClient,
  userId: string,
  tier: ReferralTierLevel
): Promise<AddBananasResult> {
  const { TIER_UNLOCK_BONUSES, TIER_NAMES } = await import('./config');
  const amount = TIER_UNLOCK_BONUSES[tier];

  if (amount <= 0) {
    return {
      success: false,
      newBalance: 0,
      transactionId: null,
      error: 'No bonus for this tier',
    };
  }

  return addBananas(
    supabase,
    userId,
    amount,
    'tier_bonus',
    undefined,
    `${TIER_NAMES[tier]} tier unlock bonus!`
  );
}

/**
 * Clawback bananas due to fraud
 */
export async function clawbackBananas(
  supabase: SupabaseClient,
  userId: string,
  amount: number,
  originalTransactionId: string,
  reason: string
): Promise<AddBananasResult> {
  return spendBananas(
    supabase,
    userId,
    amount,
    'clawback',
    originalTransactionId,
    `Clawback: ${reason}`
  );
}

/**
 * Get total bananas earned from referrals
 */
export async function getReferralBananasEarned(
  supabase: SupabaseClient,
  userId: string
): Promise<number> {
  const { data, error } = await supabase
    .from('banana_transactions')
    .select('amount')
    .eq('user_id', userId)
    .in('transaction_type', ['referral', 'collaboration', 'tier_bonus'])
    .gt('amount', 0);

  if (error) {
    console.error('Error getting referral bananas:', error);
    return 0;
  }

  return data.reduce((sum, tx) => sum + tx.amount, 0);
}
