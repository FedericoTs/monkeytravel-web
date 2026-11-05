import { bananasEconomyStats } from "./bananas";
import { collaborationStats } from "./collaboration";
import { funnelStats, lifecycleStats } from "./funnel";
import { referralStats } from "./referral";
import { activitySignals, ahaMomentStats, retentionStats } from "./retention";
import type { GrowthRows } from "./rows";
import type { GrowthStats } from "./types";

/** The Growth tab's numbers, from the rows it reads. */
export function computeGrowthStats(rows: GrowthRows, dataWarnings: string[], now: Date): GrowthStats {
  const signals = activitySignals(rows);
  const referral = referralStats(rows);
  return {
    retention: retentionStats(rows.users, signals, now),
    funnel: funnelStats(rows, signals),
    lifecycle: lifecycleStats(rows),
    referral,
    ahaMoments: ahaMomentStats(rows, signals, now),
    collaboration: collaborationStats(rows),
    bananasEconomy: bananasEconomyStats(rows, now),
    meta: {
      retentionMethod: signals.signInTrackingAvailable ? "sign_in" : "activity_proxy",
      signInTrackingAvailable: signals.signInTrackingAvailable,
      referralAttributionWired: referral.referredSignups > 0,
      dataWarnings,
      generatedAt: now.toISOString(),
    },
  };
}
