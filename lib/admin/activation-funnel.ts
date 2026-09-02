/**
 * Consent-free activation funnel for the admin dashboard.
 *
 * Every activation number the dashboard showed before 2026-09-02 came from
 * PostHog, which sees only the browsers that accepted analytics cookies and
 * run no ad blocker (about 59% at best, measured 2026-08-25). The browsers
 * that lose trips are exactly the ones PostHog cannot see. This module reads
 * the two RPCs that join what the database already knows -- auth.users,
 * wizard_step_events, trips, funnel_events -- into one cohort funnel per
 * signup provider, plus the signed-out share loop.
 *
 * The RPCs live in supabase/migrations/20260902120000_activation_funnel_rpcs.sql
 * and are callable by service_role only; pass the admin client.
 *
 * Definitions (mirrored from the SQL so a reader here need not open it):
 *   signups          accounts created in the window, test/probe emails excluded
 *   confirmed        email_confirmed_at set (Google is auto-confirmed)
 *   reachedWizard    any consent-free wizard row for the user, or a trip
 *   generated        a result-type wizard row, OR a trip row (a trip proves a
 *                    generation; the event alone undercounts by half because
 *                    most generations happen signed-out)
 *   hasTrip          a live trip row exists
 *   generatedNoTrip  result-type row AND no trip: the lost bucket, strict
 *   saveFailedUsers  users with at least one save_failed row
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface ProviderFunnelRow {
  provider: string;
  signups: number;
  confirmed: number;
  reachedWizard: number;
  generated: number;
  hasTrip: number;
  generatedNoTrip: number;
  saveFailedUsers: number;
}

export interface FunnelWindow {
  days: number;
  from: string;
  to: string;
  /** Sum over providers; `provider` is "all". */
  total: ProviderFunnelRow;
  byProvider: ProviderFunnelRow[];
}

export interface AnonymousLoopWindow {
  days: number;
  /** Trips minted signed-out in the window (a share is the only way to mint one). */
  anonCreated: number;
  /** Of those, trips at least one human opened via the share link. */
  anonVisited: number;
  shareVisits: number;
  planOwnClicks: number;
  /** Of those, claimed by a signup (ever). */
  claimed: number;
  /** Claims that happened in the window, whatever the trip's age. */
  claimedAny: number;
  unclaimedLive: number;
  expired: number;
}

export interface ActivationFunnelStats {
  /** false when either RPC failed or is missing; the panel says so instead of showing zeros. */
  available: boolean;
  computedAt: string;
  last7d: FunnelWindow;
  last30d: FunnelWindow;
  prior30d: FunnelWindow;
  anonymousLoop: {
    last30d: AnonymousLoopWindow;
    prior30d: AnonymousLoopWindow;
  };
}

const DAY_MS = 86_400_000;

export interface WindowBounds {
  days: number;
  from: string;
  to: string;
}

/** Three contiguous, non-overlapping windows ending now. */
export function windowsFor(now: Date): { last7d: WindowBounds; last30d: WindowBounds; prior30d: WindowBounds } {
  const to = now.toISOString();
  const d7 = new Date(now.getTime() - 7 * DAY_MS).toISOString();
  const d30 = new Date(now.getTime() - 30 * DAY_MS).toISOString();
  const d60 = new Date(now.getTime() - 60 * DAY_MS).toISOString();
  return {
    last7d: { days: 7, from: d7, to },
    last30d: { days: 30, from: d30, to },
    prior30d: { days: 30, from: d60, to: d30 },
  };
}

/** PostgREST serialises bigint as a JSON number; older clients as a string. Either way, a finite number or 0. */
function num(v: unknown): number {
  const x = typeof v === "string" ? Number(v) : typeof v === "number" ? v : 0;
  return Number.isFinite(x) ? x : 0;
}

export function rowFromRpc(raw: Record<string, unknown>): ProviderFunnelRow {
  return {
    provider: typeof raw.provider === "string" && raw.provider ? raw.provider : "unknown",
    signups: num(raw.signups),
    confirmed: num(raw.confirmed),
    reachedWizard: num(raw.reached_wizard),
    generated: num(raw.generated),
    hasTrip: num(raw.has_trip),
    generatedNoTrip: num(raw.generated_no_trip),
    saveFailedUsers: num(raw.save_failed_users),
  };
}

export function emptyRow(provider = "all"): ProviderFunnelRow {
  return {
    provider,
    signups: 0,
    confirmed: 0,
    reachedWizard: 0,
    generated: 0,
    hasTrip: 0,
    generatedNoTrip: 0,
    saveFailedUsers: 0,
  };
}

export function sumRows(rows: ProviderFunnelRow[]): ProviderFunnelRow {
  const total = emptyRow("all");
  for (const r of rows) {
    total.signups += r.signups;
    total.confirmed += r.confirmed;
    total.reachedWizard += r.reachedWizard;
    total.generated += r.generated;
    total.hasTrip += r.hasTrip;
    total.generatedNoTrip += r.generatedNoTrip;
    total.saveFailedUsers += r.saveFailedUsers;
  }
  return total;
}

export function buildFunnelWindow(bounds: WindowBounds, rawRows: unknown): FunnelWindow {
  const rows = Array.isArray(rawRows)
    ? rawRows.filter((r): r is Record<string, unknown> => !!r && typeof r === "object").map(rowFromRpc)
    : [];
  rows.sort((a, b) => b.signups - a.signups || a.provider.localeCompare(b.provider));
  return { ...bounds, total: sumRows(rows), byProvider: rows };
}

export function loopFromRpc(days: number, raw: unknown): AnonymousLoopWindow {
  const r = Array.isArray(raw) ? raw[0] : raw;
  const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
  return {
    days,
    anonCreated: num(o.anon_created),
    anonVisited: num(o.anon_visited),
    shareVisits: num(o.share_visits),
    planOwnClicks: num(o.plan_own_clicks),
    claimed: num(o.claimed),
    claimedAny: num(o.claimed_any),
    unclaimedLive: num(o.unclaimed_live),
    expired: num(o.expired),
  };
}

export function emptyActivationFunnel(now = new Date()): ActivationFunnelStats {
  const w = windowsFor(now);
  return {
    available: false,
    computedAt: now.toISOString(),
    last7d: { ...w.last7d, total: emptyRow(), byProvider: [] },
    last30d: { ...w.last30d, total: emptyRow(), byProvider: [] },
    prior30d: { ...w.prior30d, total: emptyRow(), byProvider: [] },
    anonymousLoop: { last30d: loopFromRpc(30, null), prior30d: loopFromRpc(30, null) },
  };
}

/** Percentage with one decimal; 0 when the denominator is 0. */
export function pct(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 1000) / 10 : 0;
}

type RpcResult = { data: unknown; error: { message?: string } | null };
type RpcFn = (fn: string, args?: Record<string, unknown>) => PromiseLike<RpcResult>;

/**
 * Five RPC calls in parallel. Any failure returns the empty block with
 * `available: false` -- the dashboard must keep rendering (the same
 * allSettled discipline as the rest of the stats route), and a panel that
 * says "unavailable" is honest where zeros would lie.
 */
export async function fetchActivationFunnel(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<ActivationFunnelStats> {
  // The generated Database types do not know these functions; the structural
  // cast keeps the call sites typed without widening the client everywhere.
  const rpc = supabase.rpc.bind(supabase) as unknown as RpcFn;
  const w = windowsFor(now);
  try {
    const [r7, r30, rp30, l30, lp30] = await Promise.all([
      rpc("get_activation_funnel", { p_from: w.last7d.from, p_to: w.last7d.to }),
      rpc("get_activation_funnel", { p_from: w.last30d.from, p_to: w.last30d.to }),
      rpc("get_activation_funnel", { p_from: w.prior30d.from, p_to: w.prior30d.to }),
      rpc("get_anonymous_loop", { p_from: w.last30d.from, p_to: w.last30d.to }),
      rpc("get_anonymous_loop", { p_from: w.prior30d.from, p_to: w.prior30d.to }),
    ]);
    for (const r of [r7, r30, rp30, l30, lp30]) {
      if (r.error) throw new Error(r.error.message || "rpc error");
    }
    return {
      available: true,
      computedAt: now.toISOString(),
      last7d: buildFunnelWindow(w.last7d, r7.data),
      last30d: buildFunnelWindow(w.last30d, r30.data),
      prior30d: buildFunnelWindow(w.prior30d, rp30.data),
      anonymousLoop: {
        last30d: loopFromRpc(30, l30.data),
        prior30d: loopFromRpc(30, lp30.data),
      },
    };
  } catch (err) {
    console.error("[Admin Stats] fetchActivationFunnel failed:", err);
    return emptyActivationFunnel(now);
  }
}
