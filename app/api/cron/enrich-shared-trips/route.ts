import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  enrichTripByIdAdmin,
  BACKFILL_PAID_LOOKUPS,
} from "@/lib/images/enrichTrip";
import { logReadError } from "@/lib/supabase/log-read-error";
import { refuseUnlessCron } from "@/lib/api/cron-auth";

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

export async function GET(request: NextRequest) {
  const refused = refuseUnlessCron(request);
  if (refused) return refused;

  const started = Date.now();
  const db = createAdminClient();

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

  const { count: remaining } = logReadError("enrich shared trips: remaining", await db
    .from("trips")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .or("shared_at.not.is.null,visibility.eq.public")
    .is("trip_meta->>photos_enriched_at", null));

  return NextResponse.json({
    processed: results.length,
    upgraded: results.reduce((s, r) => s + r.upgraded, 0),
    remaining: remaining ?? null,
    elapsedMs: Date.now() - started,
    results,
  });
}
