/**
 * Dry run of the visa-reminder domestic check against the real queue.
 *
 *   npx tsx scripts/visa-domestic-dryrun.mts [--days 60]
 *
 * Replays lib/notifications/domestic-trip.ts over every visa_check_7d row
 * pending or sent in the window, using the same inputs the cron uses (the
 * trip's itinerary and the traveller's most recent page-view country), and
 * prints what the rule would do. Read-only: no row is touched.
 */
import { createClient } from "@supabase/supabase-js";
import * as Domestic from "../lib/notifications/domestic-trip";
// tsx on this repo surfaces CommonJS-compiled modules under `default`; take either shape.
const domesticTripVerdict = ((Domestic as unknown as { default?: typeof Domestic }).default ?? Domestic).domesticTripVerdict;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  process.exit(1);
}
const days = Number(process.argv[process.argv.indexOf("--days") + 1] || 60);
const svc = createClient(url, key, { auth: { persistSession: false } });

const since = new Date(Date.now() - days * 86_400_000).toISOString();
const { data: rows, error } = await svc
  .from("scheduled_notifications")
  .select("id, user_id, trip_id, status, scheduled_for")
  .eq("slot", "visa_check_7d")
  .in("status", ["pending", "sent"])
  .gte("scheduled_for", since)
  .order("scheduled_for");
if (error) throw error;

type Line = { trip: string; viewer: string | null; dest: string; status: string; verdict: string; resolved: string };
const lines: Line[] = [];
const tally: Record<string, number> = {};

for (const row of rows ?? []) {
  const { data: trip } = await svc
    .from("trips")
    .select("title, itinerary, trip_meta, deleted_at")
    .eq("id", row.trip_id)
    .maybeSingle();
  if (!trip || trip.deleted_at) continue;
  const { data: lastView } = await svc
    .from("page_views")
    .select("country_code")
    .eq("user_id", row.user_id)
    .not("country_code", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const viewer = (lastView as { country_code?: string | null } | null)?.country_code ?? null;
  const v = domesticTripVerdict(viewer, trip.itinerary);
  const verdict = v.domestic
    ? "SKIP domestic"
    : viewer === null
      ? "send (viewer unknown)"
      : v.resolved === 0
        ? "send (no readable address)"
        : "send (international)";
  tally[verdict] = (tally[verdict] ?? 0) + 1;
  const meta = (trip.trip_meta ?? {}) as { destination?: string };
  lines.push({
    trip: (meta.destination || trip.title || "").slice(0, 34),
    viewer,
    dest: v.destinationCountries.join("+") || "-",
    status: row.status,
    verdict,
    resolved: `${v.resolved}/${v.addresses}`,
  });
}

console.log(`visa_check_7d rows (pending or sent) in the last ${days} days: ${lines.length}`);
console.table(tally);
console.log("\nWould skip:");
console.table(lines.filter((l) => l.verdict.startsWith("SKIP")));
console.log("\nSend, international (spot-check that none is domestic):");
console.table(lines.filter((l) => l.verdict === "send (international)"));
console.log("\nSend, unresolved:");
console.table(lines.filter((l) => l.verdict.startsWith("send (") && l.verdict !== "send (international)"));
