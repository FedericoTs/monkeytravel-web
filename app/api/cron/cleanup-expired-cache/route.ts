import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

/**
 * Daily cron — deletes EXPIRED rows from the DB cache tables.
 *
 * Every cache table filters its reads by `expires_at > now()`, so expired rows
 * are already invisible to the app — but nothing ever reclaimed them, so the
 * tables grew unbounded. This sweep DELETEs `WHERE expires_at < now()` per
 * table.
 *
 * Tables WITHOUT an expires_at column are deliberately EXCLUDED:
 *   - places_v2 / places_v2_lookup: place_id mappings are INDEFINITE by design
 *     (they don't expire — re-resolving one costs a paid Google call, so we
 *     keep them forever). Only created_at exists on those tables.
 *
 * Safety: the `expires_at < now()` filter is applied uniformly in the loop, so
 * there is no code path that issues an unfiltered delete (and PostgREST would
 * reject one anyway). Tables are small (hundreds–thousands of rows) and
 * expires_at is indexed, so a single bounded DELETE per table is fast and never
 * contends with live reads (which only touch unexpired rows). If a table ever
 * grows large enough that one DELETE risks the 60s function cap, switch to a
 * LIMIT-loop via an RPC.
 *
 * Schedule: daily via Vercel cron (vercel.json). Manual trigger:
 *   curl -H "Authorization: Bearer $CRON_SECRET" /api/cron/cleanup-expired-cache
 *
 * Auth: CRON_SECRET. Without it, 401. Vercel sends the secret automatically.
 */

// Cache tables that carry an `expires_at` column. places_v2 / places_v2_lookup
// are intentionally absent (indefinite place_id mappings — see docstring).
const EXPIRING_CACHE_TABLES = [
  "weather_cache",
  "geocode_cache",
  "distance_cache",
  "fcdo_advisory_cache",
  "google_places_cache",
  "destination_activity_cache",
] as const;

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

  const svc = serviceClient();
  const nowIso = new Date().toISOString();
  const startedAt = Date.now();

  const perTable: Record<string, number | string> = {};
  let totalDeleted = 0;
  let hadError = false;

  // One bounded DELETE per table. A failure on one table is logged and recorded
  // but does NOT abort the others — cache cleanup is best-effort hygiene.
  for (const table of EXPIRING_CACHE_TABLES) {
    const { count, error } = await svc
      .from(table)
      .delete({ count: "exact" })
      .lt("expires_at", nowIso);

    if (error) {
      hadError = true;
      perTable[table] = `error: ${error.message}`;
      console.error(`[cleanup-expired-cache] ${table} delete failed:`, error);
      // This cron exists to PREVENT unbounded cache growth, so a table that
      // fails to clean every night silently defeats its purpose. Page someone
      // via Sentry (dynamic import — the pattern used by other API routes here),
      // not just a console log + a 500 that may go unread in cron history.
      try {
        const Sentry = await import("@sentry/nextjs");
        Sentry.captureException(error, {
          tags: { cron: "cleanup-expired-cache", table },
        });
      } catch {
        /* Sentry unavailable — console.error is the fallback */
      }
    } else {
      perTable[table] = count ?? 0;
      totalDeleted += count ?? 0;
    }
  }

  return NextResponse.json(
    {
      success: !hadError,
      totalDeleted,
      perTable,
      durationMs: Date.now() - startedAt,
      timestamp: nowIso,
    },
    { status: hadError ? 500 : 200 }
  );
}
