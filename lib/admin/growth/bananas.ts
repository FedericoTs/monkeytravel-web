import type { GrowthRows, GrowthUser } from "./rows";
import type { GrowthStats } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The name a top earner is shown under, by their leaderboard settings. */
function leaderboardName(user: GrowthUser): string {
  if (user.show_on_leaderboard === false) return "Anonymous";
  if (user.leaderboard_visibility === "initials") return `${user.display_name?.[0] || "U"}***`;
  return user.display_name || "Anonymous";
}

export function bananasEconomyStats(
  { users, bananaTransactions, referralTiers, redemptionCatalog, bananaRedemptions }: GrowthRows,
  now: Date
): GrowthStats["bananasEconomy"] {
  const earned = bananaTransactions.filter((t) => t.amount > 0);
  const sumOf = (transactions: GrowthRows["bananaTransactions"]) => transactions.reduce((sum, t) => sum + t.amount, 0);
  const userById = new Map(users.map((u) => [u.id, u]));

  // Overview.
  const totalInCirculation = users.reduce((sum, u) => sum + (u.banana_balance || 0), 0);
  const usersWithBananas = users.filter((u) => (u.banana_balance || 0) > 0).length;
  const totalEarned = sumOf(earned);
  const totalSpent = bananaTransactions.filter((t) => t.amount < 0).reduce((sum, t) => sum + Math.abs(t.amount), 0);
  const totalExpired = bananaTransactions
    .filter((t) => t.transaction_type === "expiration")
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);

  // Velocity: earned in the last 7 days against the 7 before.
  const d7Ago = new Date(now.getTime() - 7 * DAY_MS);
  const d14Ago = new Date(now.getTime() - 14 * DAY_MS);
  const current7d = sumOf(earned.filter((t) => new Date(t.created_at) >= d7Ago));
  const previous7d = sumOf(earned.filter((t) => new Date(t.created_at) >= d14Ago && new Date(t.created_at) < d7Ago));
  const changePercent =
    previous7d > 0 ? Math.round(((current7d - previous7d) / previous7d) * 100) : current7d > 0 ? 100 : 0;

  // Tiers.
  const tierCounts = { 0: 0, 1: 0, 2: 0, 3: 0 };
  users.forEach((u) => {
    tierCounts[(u.referral_tier || 0) as 0 | 1 | 2 | 3]++;
  });
  const tier = (level: 0 | 1 | 2 | 3) => ({
    count: tierCounts[level],
    pct: users.length > 0 ? Math.round((tierCounts[level] / users.length) * 100) : 0,
  });
  const avgDaysToReach = (unlockedAt: (row: GrowthRows["referralTiers"][number]) => string | null) => {
    const days = referralTiers.flatMap((row) => {
      const at = unlockedAt(row);
      const user = userById.get(row.user_id);
      if (!at || !user) return [];
      return [Math.round((new Date(at).getTime() - new Date(user.created_at).getTime()) / DAY_MS)];
    });
    return days.length > 0 ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : null;
  };

  // Earning.
  const byType: Record<string, number> = {};
  earned.forEach((t) => {
    byType[t.transaction_type] = (byType[t.transaction_type] || 0) + t.amount;
  });
  const totalByEarner = new Map<string, number>();
  earned.forEach((t) => {
    if (userById.has(t.user_id)) totalByEarner.set(t.user_id, (totalByEarner.get(t.user_id) || 0) + t.amount);
  });
  const topEarners = [...totalByEarner.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([userId, total]) => {
      const user = userById.get(userId) as GrowthUser;
      return { displayName: leaderboardName(user), total, tier: user.referral_tier || 0 };
    });

  // Redemptions.
  const catalogById = new Map(redemptionCatalog.map((item) => [item.id, item]));
  const itemCounts = new Map<string, { name: string; count: number; spent: number }>();
  bananaRedemptions.forEach((r) => {
    const item = catalogById.get(r.catalog_item_id);
    if (!item) return;
    const existing = itemCounts.get(item.id) || { name: item.name, count: 0, spent: 0 };
    itemCounts.set(item.id, { ...existing, count: existing.count + 1, spent: existing.spent + r.bananas_spent });
  });

  // What expires within 30 days, and how much of what was earned didn't.
  const d30FromNow = new Date(now.getTime() + 30 * DAY_MS);
  const atRisk = earned.filter(
    (t) => !t.expired && t.expires_at && new Date(t.expires_at) > now && new Date(t.expires_at) <= d30FromNow
  );

  return {
    overview: {
      totalInCirculation,
      totalEarned,
      totalSpent,
      totalExpired,
      avgPerUser: usersWithBananas > 0 ? Math.round(totalInCirculation / usersWithBananas) : 0,
      velocity: { current7d, previous7d, changePercent },
    },
    tierDistribution: {
      tier0: tier(0),
      tier1: tier(1),
      tier2: tier(2),
      tier3: tier(3),
      avgDaysToTier: {
        tier1: avgDaysToReach((row) => row.tier_1_unlocked_at),
        tier2: avgDaysToReach((row) => row.tier_2_unlocked_at),
        tier3: avgDaysToReach((row) => row.tier_3_unlocked_at),
      },
    },
    earningBreakdown: { byType, topEarners },
    redemptions: {
      total: bananaRedemptions.length,
      bananasSpent: totalSpent,
      uniqueRedeemers: new Set(bananaRedemptions.map((r) => r.user_id)).size,
      redemptionRate: totalEarned > 0 ? Math.round((totalSpent / totalEarned) * 1000) / 10 : 0,
      topItems: [...itemCounts.values()].sort((a, b) => b.count - a.count).slice(0, 5),
    },
    expiration: {
      atRisk30d: sumOf(atRisk),
      atRiskUsers: new Set(atRisk.map((t) => t.user_id)).size,
      totalExpired,
      utilizationRate: totalEarned > 0 ? Math.round(((totalEarned - totalExpired) / totalEarned) * 1000) / 10 : 100,
    },
  };
}
