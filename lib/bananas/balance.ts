/**
 * Banana Balance Operations
 *
 * Functions for getting user banana balance and expiration info.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import type { BananaBalanceInfo, BananaTransactionRow } from '@/types/bananas';
import { EXPIRATION_WARNING_DAYS } from './config';
import { logReadError } from '@/lib/supabase/log-read-error';

/**
 * Get user's banana balance with expiration details
 */
export async function getBananaBalance(
  supabase: SupabaseClient,
  userId: string
): Promise<BananaBalanceInfo> {
  // Get user's cached balance
  const { data: user } = logReadError('bananas: balance', await supabase
    .from('users')
    .select('banana_balance')
    .eq('id', userId)
    .single());

  // Get transaction history for detailed info
  const { data: transactions } = logReadError('bananas: transactions', await supabase
    .from('banana_transactions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true }));

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

