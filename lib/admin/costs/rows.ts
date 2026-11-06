import { createAdminClient } from "@/lib/supabase/admin";
import { logReadError } from "@/lib/supabase/log-read-error";
import { PAGE_ROWS, readAllRows, readWholeTable } from "@/lib/supabase/read-all-rows";
import type { SpendGroup } from "@/lib/ops/spend";

const DAY_MS = 24 * 60 * 60 * 1000;
const LOG_COLUMNS =
  "id, api_name, endpoint, cost_usd, cache_hit, timestamp, response_status, response_time_ms, user_id, error_message";

export type LogRow = {
  id: string;
  api_name: string | null;
  endpoint: string | null;
  cost_usd: number | null;
  cache_hit: boolean | null;
  timestamp: string | null;
  response_status: number | null;
  response_time_ms: number | null;
  user_id: string | null;
  error_message: string | null;
};
type CacheRow = { id: string; hit_count: number | null };

/** Everything the Costs tab counts from. */
export interface CostRows {
  /** Every call of the last 30 days, test calls aside. */
  logs: LogRow[];
  /** The all-time sums, by API and unit price. */
  spend: Array<{ calls: number; usd: number }>;
  /** This month so far, the whole of last month and the last 7 days, the same way. */
  thisMonth: SpendGroup[];
  lastMonth: SpendGroup[];
  lastWeek: SpendGroup[];
  /** The newest calls, for the feed. */
  recentLogs: LogRow[];
  caches: { geocode: CacheRow[]; distance: CacheRow[]; places: CacheRow[]; activities: CacheRow[] };
  users: Array<{ id: string; email: string | null }>;
}

/**
 * Read with the service role, for admins only: the logs hold every user's ids and
 * searches. A read that fails is logged and counts as empty, so one table can't cost
 * the whole tab.
 */
export async function readCostRows(now: Date): Promise<CostRows> {
  const db = createAdminClient();
  const day30Ago = new Date(now.getTime() - 30 * DAY_MS).toISOString();
  const cache = (table: string) => readWholeTable<CacheRow>(db, table, "id, hit_count");
  const spendBetween = (from: number, to: number) =>
    db.rpc("api_spend_by_unit", { p_from: new Date(from).toISOString(), p_to: new Date(to).toISOString() });
  const thisMonthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);

  const [logs, spend, thisMonth, lastMonth, lastWeek, recentLogs, geocode, distance, places, activities, users] = await Promise.all([
    // Newest first by timestamp, which is indexed; a batch of logs can share one.
    readAllRows<LogRow>((last) => {
      const rows = db.from("api_request_logs").select(LOG_COLUMNS).gte("timestamp", day30Ago).is("request_params->>probe", null);
      return (last ? rows.lte("timestamp", last.timestamp as string) : rows)
        .order("timestamp", { ascending: false })
        .order("id")
        .limit(PAGE_ROWS) as unknown as PromiseLike<{ data: LogRow[] | null; error: { message: string } | null }>;
    }),
    // The all-time total is a sum in the database, over a table too big to read.
    spendBetween(0, now.getTime()),
    spendBetween(thisMonthStart, now.getTime()),
    spendBetween(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1), thisMonthStart),
    spendBetween(now.getTime() - 7 * DAY_MS, now.getTime()),
    db.from("api_request_logs").select(LOG_COLUMNS).order("timestamp", { ascending: false }).limit(50),
    cache("geocode_cache"),
    cache("distance_cache"),
    cache("google_places_cache"),
    cache("destination_activity_cache"),
    // For naming who spent what.
    readWholeTable<{ id: string; email: string | null }>(db, "users", "id, email"),
  ]);

  return {
    logs: logReadError("admin costs: 30-day logs", logs).data || [],
    spend: (logReadError("admin costs: all-time spend", spend).data || []) as CostRows["spend"],
    thisMonth: (logReadError("admin costs: this month's spend", thisMonth).data || []) as SpendGroup[],
    lastMonth: (logReadError("admin costs: last month's spend", lastMonth).data || []) as SpendGroup[],
    lastWeek: (logReadError("admin costs: last week's spend", lastWeek).data || []) as SpendGroup[],
    recentLogs: (logReadError("admin costs: recent logs", recentLogs).data || []) as unknown as LogRow[],
    caches: {
      geocode: logReadError("admin costs: geocode cache", geocode).data || [],
      distance: logReadError("admin costs: distance cache", distance).data || [],
      places: logReadError("admin costs: places cache", places).data || [],
      activities: logReadError("admin costs: activities cache", activities).data || [],
    },
    users: logReadError("admin costs: users", users).data || [],
  };
}
