import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import {
  enrichTripByIdAdmin,
  BACKFILL_PAID_LOOKUPS,
} from "@/lib/images/enrichTrip";

/**
 * Daily cron + manual backfill — real photos for every voter-facing trip.
 *
 * P1 of the co-creation plan (docs/PRODUCT_PLAN_COCREATION_2026_08.md): shared
 * and published trips created before the share/publish enrichment hooks (or
 * arriving via paths that never enrich — forks, duplicates, template copies
 * that later get published) still show generation-time curated fallbacks to
 * voters. This sweep upgrades them.
 *
 * Selection: non-deleted trips that are shared or public and have never been
 * stamped photos_enriched_at. The stamp is written by enrichTripRecord, so a
 * processed trip drops out of the queue permanently — the sweep converges.
 *
 * Time-boxed: cron functions get 60s (vercel.json). Each trip can spend up to
 * BACKFILL_PAID_LOOKUPS paid lookups (2 sequential Google calls each), so we
 * stop picking up new trips once 40s have elapsed and report the remainder.
 * The daily schedule (or repeated manual calls) drains the rest.
 *
 * Manual trigger:
 *   curl -H "Authorization: Bearer $CRON_SECRET" /api/cron/enrich-shared-trips
 *
 * Auth: CRON_SECRET. Without it, 401. Vercel sends the secret automatically.
 */

const TIME_BUDGET_MS = 40_000;
const MAX_TRIPS_PER_RUN = 10;

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env missing for cron");
  return createServiceClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Don't run unauthenticated, even if CRON_SECRET isn't set.
    return unauthorized();
  }
  if (auth !== `Bearer ${secret}`) return unauthorized();

  const started = Date.now();
  const db = serviceClient();

  // photos_enriched_at lives inside trip_meta; ->> on a missing key is NULL.
  const { data: candidates, error } = await db
    .from("trips")
    .select("id, shared_at")
    .is("deleted_at", null)
    .or("shared_at.not.is.null,visibility.eq.public")
    .is("trip_meta->>photos_enriched_at", null)
    .order("shared_at", { ascending: false, nullsFirst: false })
    .limit(MAX_TRIPS_PER_RUN);

  if (error) {
    console.error("[enrich-shared-trips] queue query failed:", error);
    return NextResponse.json({ error: "queue query failed" }, { status: 500 });
  }

  const results: Array<{
    tripId: string;
    upgraded: number;
    real: number;
    total: number;
    skipped: string | null;
  }> = [];

  for (const row of candidates ?? []) {
    if (Date.now() - started > TIME_BUDGET_MS) break;
    const outcome = await enrichTripByIdAdmin(row.id, "cron_backfill", {
      maxPaidLookups: BACKFILL_PAID_LOOKUPS,
    });
    if (outcome) {
      results.push({
        tripId: row.id,
        upgraded: outcome.after.real - outcome.before.real,
        real: outcome.after.real,
        total: outcome.after.total,
        skipped: outcome.skipped,
      });
    } else {
      results.push({ tripId: row.id, upgraded: 0, real: 0, total: 0, skipped: "error" });
    }
  }

  const { count: remaining } = await db
    .from("trips")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .or("shared_at.not.is.null,visibility.eq.public")
    .is("trip_meta->>photos_enriched_at", null);

  return NextResponse.json({
    processed: results.length,
    upgraded: results.reduce((s, r) => s + r.upgraded, 0),
    remaining: remaining ?? null,
    elapsedMs: Date.now() - started,
    results,
  });
}
