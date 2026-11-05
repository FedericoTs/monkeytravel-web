export type TripRow = {
  id: string;
  user_id: string | null;
  status: string;
  title: string;
  trip_meta: unknown;
  created_at: string;
};
export type AiUsageRow = {
  id: string;
  action: string;
  model_id: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_cents: number | string | null;
};
export type GeminiLog = {
  id: string;
  cost_usd: number | null;
  endpoint: string | null;
  response_status: number | null;
  cache_hit: boolean | null;
};

// A plan comes from the streaming route, or from the JSON one as its fallback.
const PLAN_ENDPOINTS = new Set(["/api/ai/generate", "/api/ai/generate/stream"]);

function countBy<T>(rows: T[], keyOf: (row: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  rows.forEach((row) => {
    const key = keyOf(row);
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
}

export const tripsByStatus = (trips: TripRow[]) => countBy(trips, (t) => t.status);
export const usageByAction = (usage: AiUsageRow[]) => countBy(usage, (u) => u.action);
export const usageByModel = (usage: AiUsageRow[]) => countBy(usage, (u) => u.model_id);

export function usageTotals(usage: AiUsageRow[]) {
  let inputTokens = 0;
  let outputTokens = 0;
  let costCents = 0;
  usage.forEach((u) => {
    inputTokens += u.input_tokens || 0;
    outputTokens += u.output_tokens || 0;
    costCents += Number(u.cost_cents) || 0;
  });
  return { inputTokens, outputTokens, costCents };
}

/** What the model has cost, and what it made: not a refused call, and not one the cache answered. */
export function generationCosts(logs: GeminiLog[]) {
  let totalCostUsd = 0;
  let generateCount = 0;
  let regenerateCount = 0;
  logs.forEach((log) => {
    totalCostUsd += Number(log.cost_usd) || 0;
    const made = (log.response_status ?? 0) < 400 && !log.cache_hit;
    if (made && PLAN_ENDPOINTS.has(log.endpoint ?? "")) generateCount++;
    if (made && log.endpoint === "/api/ai/regenerate-activity") regenerateCount++;
  });
  return { totalCostUsd, generateCount, regenerateCount };
}

/**
 * The ten places most planned. trip_meta.destination is set by the wizard; the title
 * is only a fallback, since a renamed trip or a title in another language says less.
 */
export function topDestinations(trips: TripRow[]): { destination: string; count: number }[] {
  const counts: Record<string, number> = {};
  trips.forEach((t) => {
    const meta = (t.trip_meta ?? {}) as Record<string, unknown>;
    const fromMeta = typeof meta.destination === "string" ? meta.destination.trim() : "";
    const destination = fromMeta || t.title.replace(/ Trip$/i, "").trim();
    if (!destination) return;
    counts[destination] = (counts[destination] || 0) + 1;
  });
  return Object.entries(counts)
    .map(([destination, count]) => ({ destination, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}
