import { PLACES_SKU_LIST_PRICE, PLACE_PHOTO_USD_PER_CALL, type PlacesSku } from "@/lib/api-gateway/places-sku";

/** One group from api_spend_by_unit: an API's calls at one per-call cost in a window. */
export interface SpendGroup {
  api_name: string;
  unit_usd: number;
  calls: number;
  usd: number;
}

export interface ApiSpend {
  apiName: string;
  calls: number;
  /** As logged, at Google's list price. */
  listUsd: number;
  /** After Google's free monthly allowance. */
  estimatedUsd: number;
}

export interface SpendSummary {
  listUsd: number;
  estimatedUsd: number;
  byApi: ApiSpend[];
  over: boolean;
}

interface Allowance {
  sku: PlacesSku | "place_photo";
  unitUsd: number;
  freePerMonth: number;
}

const placesSku = (sku: PlacesSku, freePerMonth: number): Allowance => ({
  sku,
  unitUsd: PLACES_SKU_LIST_PRICE[sku].usdPer1000 / 1000,
  freePerMonth,
});

/**
 * The SKUs each API logs, told apart by the list price it books per call, with
 * Google's free calls a month as the header of places-sku.ts gives them. The
 * free IDs Only calls log at 0 and need no allowance.
 */
const ALLOWANCES = new Map<string, Allowance[]>([
  [
    "google_places_details",
    [
      placesSku("details_essentials", 10_000),
      placesSku("details_pro", 5_000),
      placesSku("details_enterprise", 1_000),
      placesSku("details_enterprise_atmosphere", 1_000),
    ],
  ],
  [
    "google_places_search",
    [
      placesSku("text_search_pro", 5_000),
      placesSku("text_search_enterprise", 1_000),
      placesSku("text_search_enterprise_atmosphere", 1_000),
    ],
  ],
  ["google_places_photo", [{ sku: "place_photo", unitUsd: PLACE_PHOTO_USD_PER_CALL, freePerMonth: 1_000 }]],
]);

function allowanceFor(apiName: string, unitUsd: number): Allowance | null {
  const micros = Math.round(unitUsd * 1e6);
  return ALLOWANCES.get(apiName)?.find((a) => Math.round(a.unitUsd * 1e6) === micros) ?? null;
}

/**
 * Yesterday's spend after Google's free monthly allowances. A SKU's free calls
 * go first, so yesterday pays for max(0, after - free) - max(0, before - free)
 * calls, counting the month's calls before and through yesterday. Gemini and
 * anything unknown cost what was logged. Months are UTC; Google's are Pacific.
 */
export function summarizeSpend(monthBefore: SpendGroup[], day: SpendGroup[], limitUsd: number): SpendSummary {
  const used = new Map<string, number>();
  for (const g of monthBefore) {
    const a = allowanceFor(g.api_name, g.unit_usd);
    if (a) used.set(a.sku, (used.get(a.sku) ?? 0) + g.calls);
  }

  const totals = new Map<string, ApiSpend>();
  for (const g of day) {
    let estimatedUsd = g.usd;
    const a = allowanceFor(g.api_name, g.unit_usd);
    if (a) {
      const before = used.get(a.sku) ?? 0;
      const billable = Math.max(0, before + g.calls - a.freePerMonth) - Math.max(0, before - a.freePerMonth);
      used.set(a.sku, before + g.calls);
      estimatedUsd = billable * a.unitUsd;
    }
    const t = totals.get(g.api_name) ?? { apiName: g.api_name, calls: 0, listUsd: 0, estimatedUsd: 0 };
    t.calls += g.calls;
    t.listUsd += g.usd;
    t.estimatedUsd += estimatedUsd;
    totals.set(g.api_name, t);
  }

  const byApi = [...totals.values()]
    .map((t) => ({ ...t, listUsd: round(t.listUsd), estimatedUsd: round(t.estimatedUsd) }))
    .sort((a, b) => b.estimatedUsd - a.estimatedUsd || b.listUsd - a.listUsd);
  const listUsd = round(byApi.reduce((s, a) => s + a.listUsd, 0));
  const estimatedUsd = round(byApi.reduce((s, a) => s + a.estimatedUsd, 0));
  return { listUsd, estimatedUsd, byApi, over: estimatedUsd > limitUsd };
}

/** The UTC day before `now`, as [start, end) ISO strings and a YYYY-MM-DD label. */
export function previousUtcDay(now = new Date()): { start: string; end: string; label: string } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString(), label: start.toISOString().slice(0, 10) };
}

/** From the 1st of `day`'s UTC month to the start of `day`, as [start, end): empty when `day` is the 1st. */
export function monthToDateBefore(day: { start: string }): { start: string; end: string } {
  const d = new Date(day.start);
  return { start: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString(), end: day.start };
}

const round = (n: number) => Math.round(n * 100) / 100;
