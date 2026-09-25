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
 * touched. Trips in the trash are left alone, and so are trips in progress
 * today (the write moves updated_at, which the "edited during the trip"
 * baseline reads; their pages derive the same ids anyway). Each trip is written
 * compare-and-set on itinerary_version AND updated_at: the version ignores
 * photo-only writes (photo enrichment), updated_at moves on every write, so
 * nothing that lands meanwhile is overwritten (that trip is reported and
 * skipped; run again until the dry run says 0). The write moves
 * itinerary_version (ids are content). Avoid 05:17 UTC (photo cron).
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
const today = new Date().toISOString().slice(0, 10);
// Keyset paging by id: an offset scan skips a row when a trip is deleted
// (hard or soft) mid-run.
let lastId = "00000000-0000-0000-0000-000000000000";
let trips = 0;
let trashed = 0;
let inProgress = 0;
let activities = 0;
let written = 0;
const writtenIds: string[] = [];
const moved: string[] = [];

for (;;) {
  const { data, error } = await db
    .from("trips")
    .select("id, itinerary, itinerary_version, updated_at, deleted_at, start_date, end_date")
    .order("id", { ascending: true })
    .gt("id", lastId)
    .limit(PAGE);
  if (error) throw error;
  if (!data || data.length === 0) break;
  type Row = { id: string; itinerary: unknown; itinerary_version: number; updated_at: string; deleted_at: string | null; start_date: string | null; end_date: string | null };
  for (const row of data as Row[]) {
    lastId = row.id;
    const n = missingIds(row.itinerary);
    if (n === 0) continue;
    if (row.deleted_at) {
      trashed++;
      continue;
    }
    if (row.start_date && row.end_date && row.start_date <= today && today <= row.end_date) {
      inProgress++;
      continue;
    }
    trips++;
    activities += n;
    if (!apply) continue;
    const next = ensureActivityIdsStable(row.itinerary as ItineraryDay[], row.id);
    const { data: out, error: writeError } = await db
      .from("trips")
      .update({ itinerary: next })
      .eq("id", row.id)
      .eq("itinerary_version", row.itinerary_version)
      .eq("updated_at", row.updated_at)
      .is("deleted_at", null)
      .select("id");
    if (writeError) throw writeError;
    if (out && out.length === 1) {
      written++;
      writtenIds.push(row.id);
    } else moved.push(row.id);
  }
}

console.log(`${apply ? "APPLY" : "DRY RUN"}: ${trips} live trips with ${activities} activities without an id (left alone: ${trashed} in the trash, ${inProgress} in progress today)`);
if (apply) {
  console.log(`written: ${written}`);
  console.log(`written ids: ${writtenIds.join(", ")}`);
  if (moved.length) console.log(`changed meanwhile, skipped (run again): ${moved.join(", ")}`);
}
