/**
 * Backfill trip_meta.timezone from itinerary coordinates — Live Trip Phase 3.1.
 *
 * New trips get the zone at save time (lib/trips/persistTrip.ts). This fills
 * it in for trips created before 3.1, so Today mode opens on the correct day
 * for the ~200 upcoming/live trips without a reload-time viewer-tz guess.
 *
 *   npx tsx scripts/backfill-trip-timezone.mts            # report
 *   npx tsx scripts/backfill-trip-timezone.mts --apply    # write trip_meta.timezone
 *   npx tsx scripts/backfill-trip-timezone.mts --apply --upcoming-only
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (env or .env.local).
 * Every row it changes is backed up first under --backup-dir (default: OS temp).
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// tsx loads this .ts module as CJS from an .mts script (no "type":"module"),
// so only `default` survives; import as a namespace and unwrap.
import * as TzMod from "../lib/trip/derive-timezone";
import type { ItineraryDay } from "../types";

type DeriveFn = (itinerary: ItineraryDay[] | null | undefined) => string | null;
const tzm = TzMod as Record<string, unknown> & { default?: Record<string, unknown> };
const deriveTimezoneFromItinerary =
  (tzm.deriveTimezoneFromItinerary ?? tzm.default?.deriveTimezoneFromItinerary) as DeriveFn;
if (typeof deriveTimezoneFromItinerary !== "function") {
  throw new Error("lib/trip/timezone did not load — check the tsx loader");
}

const env: Record<string, string> = {};
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const need = (k: string) => process.env[k] ?? env[k] ?? "";
const url = need("NEXT_PUBLIC_SUPABASE_URL");
const key = need("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const UPCOMING_ONLY = args.includes("--upcoming-only");
const opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const BACKUP_DIR = opt("--backup-dir") ?? join(tmpdir(), "monkeytravel-backfill-trip-tz");

const supabase = createClient(url, key, { auth: { persistSession: false } });

type Row = {
  id: string;
  start_date: string;
  end_date: string;
  itinerary: unknown;
  trip_meta: Record<string, unknown> | null;
  public_slug: string | null;
};

function daysOf(itinerary: unknown): ItineraryDay[] {
  if (Array.isArray(itinerary)) return itinerary as ItineraryDay[];
  const d = (itinerary as { days?: unknown } | null)?.days;
  return Array.isArray(d) ? (d as ItineraryDay[]) : [];
}

async function main() {
  console.log(`mode: ${APPLY ? "APPLY" : "dry-run"}${UPCOMING_ONLY ? " (upcoming/live only)" : ""}`);
  const rows: Row[] = [];
  const PAGE = 500;
  const todayIso = new Date().toISOString().slice(0, 10);
  for (let from = 0; ; from += PAGE) {
    let q = supabase
      .from("trips")
      .select("id, start_date, end_date, itinerary, trip_meta, public_slug")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (UPCOMING_ONLY) q = q.gte("end_date", todayIso);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < PAGE) break;
  }
  console.log(`trips scanned: ${rows.length}`);

  const stats = { hasItinerary: 0, alreadySet: 0, derived: 0, noCoords: 0, applied: 0 };
  const byZone = new Map<string, number>();
  if (APPLY) mkdirSync(BACKUP_DIR, { recursive: true });

  for (const trip of rows) {
    const days = daysOf(trip.itinerary);
    if (days.length === 0) continue;
    stats.hasItinerary++;
    const meta = { ...(trip.trip_meta ?? {}) } as Record<string, unknown>;
    if (typeof meta.timezone === "string" && meta.timezone) {
      stats.alreadySet++;
      continue;
    }
    const zone = deriveTimezoneFromItinerary(days);
    if (!zone) {
      stats.noCoords++;
      continue;
    }
    stats.derived++;
    byZone.set(zone, (byZone.get(zone) ?? 0) + 1);
    if (APPLY) {
      writeFileSync(join(BACKUP_DIR, `${trip.id}.json`), JSON.stringify({ trip_meta: trip.trip_meta }, null, 2));
      meta.timezone = zone;
      const { error } = await supabase.from("trips").update({ trip_meta: meta }).eq("id", trip.id);
      if (error) { console.error(`  update failed ${trip.id}: ${error.message}`); continue; }
      stats.applied++;
    }
  }

  console.log("zones:", Object.fromEntries([...byZone.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)));
  console.log(stats);
  if (APPLY) console.log(`backups in ${BACKUP_DIR}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
