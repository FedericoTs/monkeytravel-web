/**
 * Banana Balance Operations
 *
 * Functions for getting user banana balance and expiration info.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import type { BananaBalanceInfo, BananaTransactionRow } from '@/types/bananas';
import { EXPIRATION_WARNING_DAYS } from './config';

/**
 * Get user's banana balance with expiration details
 */
export async function getBananaBalance(
  supabase: SupabaseClient,
  userId: string
): Promise<BananaBalanceInfo> {
  // Get user's cached balance
  const { data: user } = await supabase
    .from('users')
    .select('banana_balance')
    .eq('id', userId)
    .single();

  // Get transaction history for detailed info
  const { data: transactions } = await supabase
    .from('banana_transactions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  const txs = (transactions || []) as BananaTransactionRow[];
  const now = new Date();
  const warningDate = new Date(now.getTime() + EXPIRATION_WARNING_DAYS * 24 * 60 * 60 * 1000);

  let available = 0;
  let expiringSoon = 0;
  let earliestExpiration: Date | null = null;
  let lifetimeEarned = 0;
  let lifetimeSpent = 0;

  for (const tx of txs) {
    if (tx.amount > 0) {
      lifetimeEarned += tx.amount;

      // Check if this earning is still available (not expired)
      if (!tx.expired && tx.expires_at) {
        const expiresAt = new Date(tx.expires_at);
        if (expiresAt > now) {
          available += tx.amount;

          // Check if expiring soon
          if (expiresAt <= warningDate) {
            expiringSoon += tx.amount;
            if (!earliestExpiration || expiresAt < earliestExpiration) {
              earliestExpiration = expiresAt;
            }
          }
        }
      } else if (!tx.expired && !tx.expires_at) {
        // No expiration (shouldn't happen, but handle gracefully)
        available += tx.amount;
      }
    } else {
      // Spending transaction
      lifetimeSpent += Math.abs(tx.amount);
      available += tx.amount; // Subtract from available (amount is negative)
    }
  }

  // Use cached balance as source of truth if available
  const finalAvailable = user?.banana_balance ?? Math.max(0, available);

  return {
    available: finalAvailable,
    expiringSoon,
    expiringDate: earliestExpiration?.toISOString(),
    lifetimeEarned,
    lifetimeSpent,
  };
}

/**
 * Get available balance using database function (more accurate, uses locks)
 */
export async function getAvailableBalance(
  supabase: SupabaseClient,
  userId: string
): Promise<number> {
  const { data, error } = await supabase.rpc('get_available_banana_balance', {
    p_user_id: userId,
  });

  if (error) {
    console.error('Error getting available balance:', error);
    // Fallback to cached balance
    const { data: user } = await supabase
      .from('users')
      .select('banana_balance')
      .eq('id', userId)
      .single();
    return user?.banana_balance ?? 0;
  }

  return data ?? 0;
}

/**
 * Check if user has enough bananas for a purchase
 */
export async function hasEnoughBananas(
  supabase: SupabaseClient,
  userId: string,
  amount: number
): Promise<boolean> {
  const available = await getAvailableBalance(supabase, userId);
  return available >= amount;
}

/**
 * Get expiring bananas for notification
 */
export async function getExpiringBananas(
  supabase: SupabaseClient,
  userId: string,
  days: number = EXPIRATION_WARNING_DAYS
): Promise<{ amount: number; expiringAt: string } | null> {
  const now = new Date();
  const warningDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  const { data: transactions } = await supabase
    .from('banana_transactions')
    .select('amount, expires_at')
    .eq('user_id', userId)
    .eq('expired', false)
    .gt('amount', 0)
    .gt('expires_at', now.toISOString())
    .lte('expires_at', warningDate.toISOString())
    .order('expires_at', { ascending: true });

  if (!transactions || transactions.length === 0) {
    return null;
  }

  const totalExpiring = transactions.reduce((sum, tx) => sum + tx.amount, 0);
  const earliestExpiration = transactions[0].expires_at;

  return {
    amount: totalExpiring,
    expiringAt: earliestExpiration,
  };
}
