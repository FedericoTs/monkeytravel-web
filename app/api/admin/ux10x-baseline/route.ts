// app/api/admin/ux10x-baseline/route.ts
//
// UX10X Master Plan Phase 0.5 — the "North Star" baseline endpoint that backs
// the Ux10xBaselineCard on /admin. Reads the two objects created in the
// 20260703_ux10x_baseline migration:
//   - vw_ux10x_daily_baseline  (rolling 90d daily funnel counts)
//   - get_ux10x_rates(lo, hi)  (windowed step1->2 % + Weekly Active Crews)
//
// Auth: same shape as /api/admin/stats — verify the admin with the
// user-context client via getAuthenticatedAdmin(), THEN read every metric with
// the service-role client (both the view and the RPC are revoked from
// anon/authenticated and only granted to service_role).

import { getAuthenticatedAdmin } from "@/lib/api/auth";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { createAdminClient } from "@/lib/supabase/admin";

export interface Ux10xDailyRow {
  day: string;
  anonStep1Sessions: number;
  saves: number;
  tripsCreated: number;
  tripsShared: number;
  aiConversations: number;
}

export interface Ux10xBaseline {
  generatedAt: string;
  window7d: { lo: string; hi: string };
  // The windowed rates for the trailing 7 days.
  rates: { step1To2Pct: number; weeklyActiveCrews: number };
  // Trailing-7d rollup of the daily counts (sum).
  last7d: {
    anonStep1Sessions: number;
    saves: number;
    tripsCreated: number;
    tripsShared: number;
    aiConversations: number;
  };
  daily: Ux10xDailyRow[];
  // The frozen reference baseline (2026-06-01 .. 2026-07-02) from the plan, so
  // the card can render "now vs baseline" without another query. Static by
  // design — this is the line the whole initiative is measured against.
  frozenBaseline: {
    label: string;
    anonStep1PerDayMedian: number;
    step1To2Pct: number;
    savesPerDay: number;
    shareCreationPct: number;
    aiConversationsPerDay: number;
    weeklyActiveCrews: number;
  };
}

const FROZEN_BASELINE: Ux10xBaseline["frozenBaseline"] = {
  label: "2026-06-01 → 07-02",
  anonStep1PerDayMedian: 36,
  step1To2Pct: 43.2,
  savesPerDay: 1.3,
  shareCreationPct: 7.3,
  aiConversationsPerDay: 0.6,
  weeklyActiveCrews: 0,
};

export async function GET() {
  try {
    const { errorResponse } = await getAuthenticatedAdmin();
    if (errorResponse) return errorResponse;

    const supabase = createAdminClient();

    const hi = new Date();
    const lo = new Date(hi.getTime() - 7 * 86_400_000);

    const [dailyRes, ratesRes] = await Promise.all([
      supabase.from("vw_ux10x_daily_baseline").select("*"),
      supabase.rpc("get_ux10x_rates", {
        lo: lo.toISOString(),
        hi: hi.toISOString(),
      }),
    ]);

    if (dailyRes.error) {
      console.error("[UX10X Baseline] daily view query failed:", dailyRes.error);
      return errors.internal("Failed to load daily baseline", "UX10X Baseline");
    }
    if (ratesRes.error) {
      console.error("[UX10X Baseline] rates RPC failed:", ratesRes.error);
      return errors.internal("Failed to load baseline rates", "UX10X Baseline");
    }

    const daily: Ux10xDailyRow[] = (dailyRes.data ?? []).map((r) => ({
      day: r.day as string,
      anonStep1Sessions: Number(r.anon_step1_sessions) || 0,
      saves: Number(r.saves) || 0,
      tripsCreated: Number(r.trips_created) || 0,
      tripsShared: Number(r.trips_shared) || 0,
      aiConversations: Number(r.ai_conversations) || 0,
    }));

    // View is ordered day DESC, so the first 7 rows are the trailing week.
    const last7Rows = daily.slice(0, 7);
    const last7d = last7Rows.reduce(
      (acc, r) => ({
        anonStep1Sessions: acc.anonStep1Sessions + r.anonStep1Sessions,
        saves: acc.saves + r.saves,
        tripsCreated: acc.tripsCreated + r.tripsCreated,
        tripsShared: acc.tripsShared + r.tripsShared,
        aiConversations: acc.aiConversations + r.aiConversations,
      }),
      {
        anonStep1Sessions: 0,
        saves: 0,
        tripsCreated: 0,
        tripsShared: 0,
        aiConversations: 0,
      },
    );

    // RPC returns a single-row table.
    const rateRow = Array.isArray(ratesRes.data) ? ratesRes.data[0] : ratesRes.data;
    const rates = {
      step1To2Pct: Number(rateRow?.step1_to_2_pct) || 0,
      weeklyActiveCrews: Number(rateRow?.weekly_active_crews) || 0,
    };

    const payload: Ux10xBaseline = {
      generatedAt: hi.toISOString(),
      window7d: { lo: lo.toISOString(), hi: hi.toISOString() },
      rates,
      last7d,
      daily,
      frozenBaseline: FROZEN_BASELINE,
    };

    return apiSuccess(payload);
  } catch (error) {
    console.error("[UX10X Baseline] Error:", error);
    return errors.internal("Failed to fetch UX10X baseline", "UX10X Baseline");
  }
}
