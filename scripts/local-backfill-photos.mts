/**
 * LOCAL one-off backfill runner for P1 (real photos on shared/published trips).
 * Not committed / not deployed — the deployed equivalent is
 * /api/cron/enrich-shared-trips; this exists because CRON_SECRET is not
 * available locally and the backfill shouldn't wait days for the daily cron.
 *
 * Usage:  npx tsx scripts/local-backfill-photos.mts [maxTrips]
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const maxTrips = Number(process.argv[2] ?? "1");

async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const { enrichTripByIdAdmin, BACKFILL_PAID_LOOKUPS } = await import(
    "../lib/images/enrichTrip"
  );

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const topup = process.argv[3] === "topup";

  let candidates: Array<{ id: string; title: string | null }> = [];
  if (!topup) {
    const { data, error } = await db
      .from("trips")
      .select("id, title, shared_at")
      .is("deleted_at", null)
      .or("shared_at.not.is.null,visibility.eq.public")
      .is("trip_meta->>photos_enriched_at", null)
      .order("shared_at", { ascending: false, nullsFirst: false })
      .limit(maxTrips);
    if (error) throw error;
    candidates = data ?? [];
  } else {
    // Top-up mode: already-stamped shared/public trips whose 15-lookup pass
    // left curated activities behind. Bypasses the cooldown, bigger budget.
    const { data, error } = await db
      .from("trips")
      .select("id, title, itinerary")
      .is("deleted_at", null)
      .or("shared_at.not.is.null,visibility.eq.public");
    if (error) throw error;
    candidates = (data ?? [])
      .map((t) => {
        let real = 0, total = 0;
        for (const day of (t.itinerary as Array<{ activities?: Array<{ image_url?: string }> }>) ?? []) {
          for (const a of day.activities ?? []) {
            total += 1;
            if (a.image_url?.includes("/api/places/photo")) real += 1;
          }
        }
        return { id: t.id, title: t.title, gap: total - real };
      })
      .filter((t) => t.gap > 0)
      .sort((a, b) => b.gap - a.gap)
      .slice(0, maxTrips);
  }

  console.log(`Queue: processing ${candidates?.length ?? 0} trip(s)\n`);
  let totalUpgraded = 0;

  for (const row of candidates ?? []) {
    const t0 = Date.now();
    const outcome = await enrichTripByIdAdmin(row.id, "cron_backfill", {
      maxPaidLookups: topup ? 30 : BACKFILL_PAID_LOOKUPS,
      ...(topup ? { respectCooldown: false } : {}),
    });
    if (!outcome) {
      console.log(`✗ ${row.id.slice(0, 8)} "${row.title}" — ERROR`);
      continue;
    }
    const upgraded = outcome.after.real - outcome.before.real;
    totalUpgraded += upgraded;
    console.log(
      `✓ ${row.id.slice(0, 8)} "${row.title}" — real ${outcome.before.real}→${outcome.after.real}/${outcome.after.total} (+${upgraded}) in ${((Date.now() - t0) / 1000).toFixed(1)}s${outcome.skipped ? ` [skipped:${outcome.skipped}]` : ""}`
    );
  }

  // Actual spend this run, from the api gateway log (activity-image endpoints).
  const since = new Date(Date.now() - 30 * 60_000).toISOString();
  const { data: costRows } = await db
    .from("api_request_logs")
    .select("cost_usd")
    .gte("created_at", since)
    .like("endpoint", "%activity%");
  const spend = (costRows ?? []).reduce(
    (s: number, r: { cost_usd: number | null }) => s + (r.cost_usd ?? 0),
    0
  );
  console.log(`\nTotal upgraded: ${totalUpgraded}. Logged Places spend (last 30min, activity endpoints): $${spend.toFixed(3)}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
