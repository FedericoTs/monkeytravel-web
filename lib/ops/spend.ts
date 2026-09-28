/** One api_request_logs row, as far as spend is concerned. */
export interface SpendRow {
  api_name: string;
  cost_usd: number | null;
  request_params?: { probe?: unknown } | null;
}

export interface SpendSummary {
  totalUsd: number;
  byApi: Array<{ apiName: string; usd: number; calls: number }>;
  over: boolean;
}

/** Yesterday's paid-API spend against the daily limit. Probe rows (our own tests) are left out. */
export function summarizeSpend(rows: SpendRow[], limitUsd: number): SpendSummary {
  const totals = new Map<string, { usd: number; calls: number }>();
  for (const row of rows) {
    if (row.request_params?.probe === true) continue;
    const entry = totals.get(row.api_name) ?? { usd: 0, calls: 0 };
    entry.usd += Number(row.cost_usd) || 0;
    entry.calls += 1;
    totals.set(row.api_name, entry);
  }
  const byApi = [...totals]
    .map(([apiName, { usd, calls }]) => ({ apiName, usd: round(usd), calls }))
    .sort((a, b) => b.usd - a.usd);
  const totalUsd = round(byApi.reduce((s, a) => s + a.usd, 0));
  return { totalUsd, byApi, over: totalUsd > limitUsd };
}

/** The UTC day before `now`, as [start, end) ISO strings and a YYYY-MM-DD label. */
export function previousUtcDay(now = new Date()): { start: string; end: string; label: string } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString(), label: start.toISOString().slice(0, 10) };
}

const round = (n: number) => Math.round(n * 100) / 100;
