import { errors, apiSuccess } from '@/lib/api/response-wrapper';
import { getAuthenticatedUser } from '@/lib/api/auth';
import type { RedemptionItem, RedemptionCatalogRow } from '@/types/bananas';
import { catalogRowToApi } from '@/types/bananas';

/**
 * GET /api/bananas/catalog - Get redemption catalog
 */
export async function GET() {
  try {
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // Get all catalog items (both active and coming soon)
    const { data: catalogItems, error } = await supabase
      .from('banana_redemption_catalog')
      .select('*')
      .order('sort_order', { ascending: true });

    if (error) {
      console.error('[Bananas Catalog] Error fetching catalog:', error);
      return errors.internal('Failed to fetch catalog', 'Bananas Catalog');
    }

    // Get user's redemption history for cooldown checking
    const { data: userRedemptions } = await supabase
      .from('banana_redemptions')
      .select('catalog_item_id, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    // Map to API format and add user-specific availability info
    const items: (RedemptionItem & { canRedeem: boolean; cooldownEndsAt?: string })[] =
      (catalogItems as RedemptionCatalogRow[]).map(row => {
        const item = catalogRowToApi(row);

        // Check if user can redeem this item
        let canRedeem = item.isActive;
        let cooldownEndsAt: string | undefined;

        // Check stock
        if (item.stockLimit && item.stockRemaining !== undefined && item.stockRemaining <= 0) {
          canRedeem = false;
        }

        // Check per-user limit
        if (item.perUserLimit && userRedemptions) {
          const userRedemptionsForItem = userRedemptions.filter(
            r => r.catalog_item_id === item.id
          );
          if (userRedemptionsForItem.length >= item.perUserLimit) {
            canRedeem = false;
          }
        }

        // Check cooldown
        if (item.cooldownHours && userRedemptions) {
          const lastRedemption = userRedemptions.find(
            r => r.catalog_item_id === item.id
          );
          if (lastRedemption) {
            const lastTime = new Date(lastRedemption.created_at).getTime();
            const cooldownMs = item.cooldownHours * 60 * 60 * 1000;
            const cooldownEnd = new Date(lastTime + cooldownMs);

            if (cooldownEnd > new Date()) {
              canRedeem = false;
              cooldownEndsAt = cooldownEnd.toISOString();
            }
          }
        }

        // Check availability window
        if (item.availableFrom && new Date(item.availableFrom) > new Date()) {
          canRedeem = false;
        }
        if (item.availableUntil && new Date(item.availableUntil) < new Date()) {
          canRedeem = false;
        }

        return {
          ...item,
          canRedeem,
          cooldownEndsAt,
        };
      });

    // Separate active and coming soon items
    const activeItems = items.filter(item => item.isActive);
    const comingSoonItems = items.filter(item => !item.isActive);

    return apiSuccess({
      active: activeItems,
      comingSoon: comingSoonItems,
    });
  } catch (error) {
    console.error('[Bananas Catalog] Error in GET /api/bananas/catalog:', error);
    return errors.internal('Internal server error', 'Bananas Catalog');
  }
}
