import type { SupabaseClient } from "@supabase/supabase-js";
import { logReadError } from "@/lib/supabase/log-read-error";

// ---- Week-over-week deltas ---------------------------------------------
//
// For the four headline KPI cards we want a "+12%" / "-4%" chip showing
// momentum. We compute it by counting rows in the last 7 days vs the 7
// days before that. All four are tiny count(*) queries with head:true
// so they don't pull rows.
//
// Returns percentage change as a number rounded to integer (no '%').
// Special cases:
//   - prev=0, current>0  → return 100 (clean "+100%" instead of Infinity)
//   - prev=0, current=0  → return 0
type WoWDeltas = { users: number; trips: number; ai: number; pageViews: number };

export async function fetchWoWDeltas(supabase: SupabaseClient): Promise<WoWDeltas> {
  const now = Date.now();
  const d7 = new Date(now - 7 * 86_400_000).toISOString();
  const d14 = new Date(now - 14 * 86_400_000).toISOString();

  const countBetween = async (table: string, dateCol: string, gte: string, lt: string) => {
    const r = logReadError(`admin stats: ${table} count`, await supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .gte(dateCol, gte)
      .lt(dateCol, lt));
    return r.count ?? 0;
  };

  const pct = (curr: number, prev: number): number => {
    if (prev === 0) return curr > 0 ? 100 : 0;
    return Math.round(((curr - prev) / prev) * 100);
  };

  // 8 count queries in parallel — they're index-fast on created_at.
  const [
    uC, uP,
    tC, tP,
    aC, aP,
    pC, pP,
  ] = await Promise.all([
    countBetween("users", "created_at", d7, new Date(now).toISOString()),
    countBetween("users", "created_at", d14, d7),
    countBetween("trips", "created_at", d7, new Date(now).toISOString()),
    countBetween("trips", "created_at", d14, d7),
    countBetween("ai_usage", "created_at", d7, new Date(now).toISOString()),
    countBetween("ai_usage", "created_at", d14, d7),
    countBetween("page_views", "created_at", d7, new Date(now).toISOString()),
    countBetween("page_views", "created_at", d14, d7),
  ]).catch((err) => {
    // page_views might not exist in some envs; fail closed to zeros.
    console.warn("[Admin Stats] WoW deltas partial fail:", err);
    return [0, 0, 0, 0, 0, 0, 0, 0];
  });

  return {
    users: pct(uC, uP),
    trips: pct(tC, tP),
    ai: pct(aC, aP),
    pageViews: pct(pC, pP),
  };
}
