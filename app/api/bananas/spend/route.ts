import { NextRequest } from 'next/server';
import { errors, apiSuccess } from '@/lib/api/response-wrapper';
import { getAuthenticatedUser } from '@/lib/api/auth';
import { spendBananas, getAvailableBalance } from '@/lib/bananas';
import type { RedeemResponse, RedemptionCatalogRow } from '@/types/bananas';
import { catalogRowToApi } from '@/types/bananas';

/**
 * POST /api/bananas/spend - Redeem bananas for a catalog item
 */
export async function POST(request: NextRequest) {
  try {
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    const body = await request.json();
    const { catalogItemId } = body;

    if (!catalogItemId) {
      return errors.badRequest('Catalog item ID required');
    }

    // Get the catalog item
    const { data: catalogItem, error: catalogError } = await supabase
      .from('banana_redemption_catalog')
      .select('*')
      .eq('id', catalogItemId)
      .eq('is_active', true)
      .single();

    if (catalogError || !catalogItem) {
      return errors.notFound('Item not found or not available');
    }

    const item = catalogItem as RedemptionCatalogRow;

    // Check stock
    if (item.stock_limit !== null && item.stock_used >= item.stock_limit) {
      const response: RedeemResponse = {
        success: false,
        newBalance: await getAvailableBalance(supabase, user.id),
        errorCode: 'OUT_OF_STOCK',
        error: 'This item is out of stock',
      };
      return errors.badRequest(response.error, { ...response });
    }

    // Check per-user limit
    if (item.per_user_limit !== null) {
      const { count } = await supabase
        .from('banana_redemptions')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('catalog_item_id', catalogItemId);

      if (count !== null && count >= item.per_user_limit) {
        const response: RedeemResponse = {
          success: false,
          newBalance: await getAvailableBalance(supabase, user.id),
          errorCode: 'LIMIT_REACHED',
          error: 'You have reached the limit for this item',
        };
        return errors.badRequest(response.error, { ...response });
      }
    }

    // Check cooldown
    if (item.cooldown_hours !== null) {
      const { data: lastRedemption } = await supabase
        .from('banana_redemptions')
        .select('created_at')
        .eq('user_id', user.id)
        .eq('catalog_item_id', catalogItemId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (lastRedemption) {
        const lastTime = new Date(lastRedemption.created_at).getTime();
        const cooldownMs = item.cooldown_hours * 60 * 60 * 1000;
        const cooldownEnd = new Date(lastTime + cooldownMs);

        if (cooldownEnd > new Date()) {
          const response: RedeemResponse = {
            success: false,
            newBalance: await getAvailableBalance(supabase, user.id),
            errorCode: 'COOLDOWN_ACTIVE',
            error: `Please wait until ${cooldownEnd.toLocaleString()} to redeem this item again`,
          };
          return errors.badRequest(response.error, { ...response });
        }
      }
    }

    // Check balance
    const currentBalance = await getAvailableBalance(supabase, user.id);
    if (currentBalance < item.banana_cost) {
      const response: RedeemResponse = {
        success: false,
        newBalance: currentBalance,
        errorCode: 'INSUFFICIENT_BALANCE',
        error: `Not enough bananas. You need ${item.banana_cost}, but have ${currentBalance}`,
      };
      return errors.badRequest(response.error, { ...response });
    }

    // Create redemption record first
    const { data: redemption, error: redemptionError } = await supabase
      .from('banana_redemptions')
      .insert({
        user_id: user.id,
        catalog_item_id: catalogItemId,
        bananas_spent: item.banana_cost,
        status: 'pending',
      })
      .select()
      .single();

    if (redemptionError) {
      console.error('[Bananas Spend] Error creating redemption:', redemptionError);
      return errors.internal('Failed to create redemption', 'Bananas Spend');
    }

    // Spend bananas
    const spendResult = await spendBananas(
      supabase,
      user.id,
      item.banana_cost,
      'spend',
      redemption.id,
      `Redeemed: ${item.name}`
    );

    if (!spendResult.success) {
      // Rollback the redemption
      await supabase
        .from('banana_redemptions')
        .delete()
        .eq('id', redemption.id);

      const response: RedeemResponse = {
        success: false,
        newBalance: currentBalance,
        errorCode: 'INSUFFICIENT_BALANCE',
        error: spendResult.error || 'Failed to spend bananas',
      };
      return errors.badRequest(response.error, { ...response });
    }

    // Update stock
    if (item.stock_limit !== null) {
      await supabase
        .from('banana_redemption_catalog')
        .update({ stock_used: item.stock_used + 1 })
        .eq('id', catalogItemId);
    }

    // Mark redemption as fulfilled (for feature items that are instant)
    if (item.category === 'feature') {
      await supabase
        .from('banana_redemptions')
        .update({
          status: 'fulfilled',
          fulfilled_at: new Date().toISOString(),
        })
        .eq('id', redemption.id);
    }

    const response: RedeemResponse = {
      success: true,
      redemption: {
        id: redemption.id,
        userId: user.id,
        catalogItemId,
        catalogItem: catalogRowToApi(item),
        bananasSpent: item.banana_cost,
        status: 'fulfilled',
        fulfilledAt: new Date().toISOString(),
        createdAt: redemption.created_at,
      },
      newBalance: spendResult.newBalance,
    };

    return apiSuccess(response);
  } catch (error) {
    console.error('[Bananas Spend] Error in POST /api/bananas/spend:', error);
    return errors.internal('Internal server error', 'Bananas Spend');
  }
}
