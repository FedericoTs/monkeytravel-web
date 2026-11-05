import type { ActivitySignals } from "./retention";
import type { GrowthRows } from "./rows";
import type { GrowthStats } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** AARRR: how many of the signups got as far as each step. */
export function funnelStats({ users, trips }: GrowthRows, signals: ActivitySignals): GrowthStats["funnel"] {
  const total = users.length;
  const step = (count: number) => ({ count, percentage: total > 0 ? Math.round((count / total) * 100) : 0 });

  const returned = users.filter((u) => {
    const last = signals.lastActivityByUser.get(u.id);
    if (!last) return false;
    return last - new Date(u.created_at).getTime() > DAY_MS;
  }).length;
  // Referral here is the action, sharing a trip, not what came of it.
  const referring = new Set(trips.filter((t) => t.share_token != null).map((t) => t.user_id).filter(Boolean)).size;

  return {
    acquisition: { count: total, percentage: 100 },
    activation: step(users.filter((u) => u.onboarding_completed).length),
    retention: step(returned),
    referral: step(referring),
    revenue: step(users.filter((u) => u.subscription_tier !== "free" || u.is_pro).length),
  };
}

/** Everyone by how many trips they own. */
export function lifecycleStats({ users, trips }: GrowthRows): GrowthStats["lifecycle"] {
  const tripsByUser = new Map<string, number>();
  trips.forEach((t) => {
    if (t.user_id) tripsByUser.set(t.user_id, (tripsByUser.get(t.user_id) || 0) + 1);
  });

  const lifecycle = { new: 0, activated: 0, engaged: 0, powerUser: 0 };
  users.forEach((u) => {
    const count = tripsByUser.get(u.id) || 0;
    if (count === 0) lifecycle.new++;
    else if (count === 1) lifecycle.activated++;
    else if (count < 5) lifecycle.engaged++;
    else lifecycle.powerUser++;
  });
  return lifecycle;
}
