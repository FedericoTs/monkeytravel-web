/**
 * One-off: store activity ids on trips whose activities were saved without one
 * (every trip created before ids were stamped at creation, 2026-09-24).
 *
 *   npx tsx scripts/backfill-activity-ids.mts            # dry run: counts only
 *   npx tsx scripts/backfill-activity-ids.mts --apply    # write
 *
 * The ids are ensureActivityIdsStable's: exactly the ids the trip page already
 * derives for those activities on every load, so nothing a page shows or has
 * keyed (votes, proposals, done-marks) changes. Existing ids are never
 * touched. Each trip is written compare-and-set on itinerary_version, so a
 * save that lands meanwhile is never overwritten (that trip is reported and
 * skipped; run again). The write moves itinerary_version (ids are content).
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as activityIds from "../lib/utils/activity-id";
import type { ItineraryDay } from "../types";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function env(name: string): string {
  const file = join(ROOT, ".env.local");
  if (!existsSync(file)) throw new Error(".env.local not found");
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (m && m[1] === name) return m[2].trim().replace(/^["']|["']$/g, "");
  }
  throw new Error(`${name} missing from .env.local`);
}

// tsx loads the lib module as CommonJS: named exports sit on the default export.
const ids = ((activityIds as unknown as { default?: typeof activityIds }).default ?? activityIds) as typeof activityIds;
const ensureActivityIdsStable = ids.ensureActivityIdsStable;

const apply = process.argv.includes("--apply");
const db = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

const missingIds = (itinerary: unknown): number => {
  if (!Array.isArray(itinerary)) return 0;
  let n = 0;
  for (const day of itinerary) {
    if (!day || typeof day !== "object" || !Array.isArray((day as { activities?: unknown }).activities)) continue;
    for (const a of (day as { activities: unknown[] }).activities) {
      if (a && typeof a === "object" && !Array.isArray(a) && !(a as { id?: unknown }).id) n++;
    }
  }
  return n;
};

const PAGE = 200;
let from = 0;
let trips = 0;
let activities = 0;
let written = 0;
const moved: string[] = [];

for (;;) {
  const { data, error } = await db
    .from("trips")
    .select("id, itinerary, itinerary_version")
    .order("created_at", { ascending: true })
    .range(from, from + PAGE - 1);
  if (error) throw error;
  if (!data || data.length === 0) break;
  for (const row of data as Array<{ id: string; itinerary: unknown; itinerary_version: number }>) {
    const n = missingIds(row.itinerary);
    if (n === 0) continue;
    trips++;
    activities += n;
    if (!apply) continue;
    const next = ensureActivityIdsStable(row.itinerary as ItineraryDay[], row.id);
    const { data: out, error: writeError } = await db
      .from("trips")
      .update({ itinerary: next })
      .eq("id", row.id)
      .eq("itinerary_version", row.itinerary_version)
      .select("id");
    if (writeError) throw writeError;
    if (out && out.length === 1) written++;
    else moved.push(row.id);
  }
  from += PAGE;
}

console.log(`${apply ? "APPLY" : "DRY RUN"}: ${trips} trips with ${activities} activities without an id`);
if (apply) {
  console.log(`written: ${written}`);
  if (moved.length) console.log(`changed meanwhile, skipped (run again): ${moved.join(", ")}`);
}
