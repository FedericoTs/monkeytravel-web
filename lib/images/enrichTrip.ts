import type { SupabaseClient } from "@supabase/supabase-js";
import type { ItineraryDay } from "@/types";
import { fetchActivityImages, SAVE_TIME_PAID_LOOKUPS } from "@/lib/images/activity";
import { createAdminClient } from "@/lib/supabase/admin";
import { captureServerEvent } from "@/lib/posthog/server";

/**
 * Shared photo-enrichment core (2026-08 co-creation plan, P1).
 *
 * Why this exists: enrichment used to be reachable only through the owner-authed
 * /api/trips/[id]/enrich-photos route, and that route was only ever called from
 * the auto-save arm — so the surfaces where OTHER people look at a trip (the
 * /shared voting page, /explore) mostly showed the curated thematic fallbacks
 * baked at generation time. Voters were judging "Zhangjiajie National Park"
 * by a stock mountain photo. This module lets the share, publish, and cron
 * sweep paths run the same enrichment server-side, where the triggering
 * request's auth has already been verified.
 *
 * Budget tiers:
 * - SAVE_TIME_PAID_LOOKUPS (8): save-path top-up. Bounded small because saves
 *   are frequent and the render-time self-heal covers stragglers.
 * - SHARE_TIME_PAID_LOOKUPS (25): share/publish. A voter-facing trip should
 *   convert FULLY — a typical trip has 15-25 unique activities, and the 8-cap
 *   left the tail curated forever. Worst case ≈ 25 × $0.022 ≈ $0.55, paid only
 *   when a trip is first shared (~17% of trips), amortized by the permanent
 *   places_v2 cache.
 * - BACKFILL_PAID_LOOKUPS (15): cron sweep over historical shared/published
 *   trips. Slightly tighter because it runs over many trips at once.
 */
export const SHARE_TIME_PAID_LOOKUPS = 25;
export const BACKFILL_PAID_LOOKUPS = 15;

/**
 * Cooldown for the share/publish/cron triggers only. The 8-lookup save path is
 * exempt: a regeneration right after save legitimately introduces new curated
 * images that deserve an immediate upgrade. The voter-facing triggers instead
 * can be spammed (open share modal repeatedly), and the paid budget RESETS per
 * call for activities Google simply can't match — the stamp caps that waste at
 * one attempt per day per trip.
 */
export const REENRICH_COOLDOWN_HOURS = 24;

export type EnrichTrigger = "save" | "share" | "publish" | "cron_backfill";

export interface EnrichCounts {
  /** Activities whose image_url is a real place photo (our proxy). */
  real: number;
  /** All activities in the itinerary. */
  total: number;
}

export interface EnrichOutcome {
  skipped: "no_itinerary" | "cooldown" | null;
  before: EnrichCounts;
  after: EnrichCounts;
}

interface TripRecordForEnrich {
  id: string;
  user_id?: string | null;
  title?: string | null;
  itinerary: unknown;
  trip_meta: unknown;
}

/** Real place photos are served through our proxy; everything else (Pexels
 *  curated, Unsplash, empty) is a fallback by definition. */
export function countRealPhotos(itinerary: ItineraryDay[]): EnrichCounts {
  let real = 0;
  let total = 0;
  for (const day of itinerary) {
    for (const activity of day.activities ?? []) {
      total += 1;
      if (activity.image_url?.includes("/api/places/photo")) real += 1;
    }
  }
  return { real, total };
}

function isWithinCooldown(meta: Record<string, unknown>): boolean {
  const stamp = meta.photos_enriched_at;
  if (typeof stamp !== "string") return false;
  const at = Date.parse(stamp);
  if (Number.isNaN(at)) return false;
  return Date.now() - at < REENRICH_COOLDOWN_HOURS * 3_600_000;
}

/**
 * Run enrichment on an already-loaded trip row and persist the result.
 *
 * `db` must be a client allowed to UPDATE this trips row (the owner's RLS
 * client, or the admin client for server-initiated triggers). Stamps
 * trip_meta.photos_enriched_at so voter-facing triggers stay idempotent-cheap.
 */
export async function enrichTripRecord(
  db: SupabaseClient,
  trip: TripRecordForEnrich,
  opts: { maxPaidLookups: number; respectCooldown: boolean }
): Promise<EnrichOutcome> {
  const itinerary = trip.itinerary as ItineraryDay[] | null;
  if (!itinerary || !Array.isArray(itinerary) || itinerary.length === 0) {
    const empty = { real: 0, total: 0 };
    return { skipped: "no_itinerary", before: empty, after: empty };
  }

  const meta = (trip.trip_meta ?? {}) as Record<string, unknown>;
  const before = countRealPhotos(itinerary);

  if (opts.respectCooldown && isWithinCooldown(meta)) {
    return { skipped: "cooldown", before, after: before };
  }

  // Canonical destination (buildTripRow writes trip_meta.destination); fall
  // back to the title strip the same way getTripDestination would.
  const destination =
    (typeof meta.destination === "string" && meta.destination) ||
    trip.title?.replace(/ Trip$/, "") ||
    "";

  // Mutates each activity's image_url in place; existing real proxy URLs are
  // preserved (reresolveCurated only re-resolves the curated fallbacks).
  await fetchActivityImages(itinerary, destination, {
    maxPaidLookups: opts.maxPaidLookups,
    reresolveCurated: true,
  });

  const after = countRealPhotos(itinerary);

  const { error } = await db
    .from("trips")
    .update({
      itinerary,
      trip_meta: { ...meta, photos_enriched_at: new Date().toISOString() },
    })
    .eq("id", trip.id);
  if (error) throw error;

  return { skipped: null, before, after };
}

/**
 * Fetch-and-enrich by id with the admin client, then emit the photos_enriched
 * telemetry. This is the entry point for server-initiated triggers (share,
 * publish — via next/server `after()` — and the cron backfill), where the
 * user's session may already be gone by the time the work runs. The CALLING
 * route is responsible for having verified authorization before scheduling.
 *
 * Never throws — these triggers are best-effort by contract; a photo failure
 * must never break sharing or publishing.
 */
export async function enrichTripByIdAdmin(
  tripId: string,
  trigger: EnrichTrigger,
  opts?: { maxPaidLookups?: number; respectCooldown?: boolean }
): Promise<EnrichOutcome | null> {
  const maxPaidLookups =
    opts?.maxPaidLookups ??
    (trigger === "save" ? SAVE_TIME_PAID_LOOKUPS : SHARE_TIME_PAID_LOOKUPS);
  const respectCooldown = opts?.respectCooldown ?? trigger !== "save";

  try {
    const admin = createAdminClient();
    const { data: trip, error } = await admin
      .from("trips")
      .select("id, user_id, title, itinerary, trip_meta")
      .eq("id", tripId)
      .is("deleted_at", null)
      .single();
    if (error || !trip) return null;

    const outcome = await enrichTripRecord(admin, trip, {
      maxPaidLookups,
      respectCooldown,
    });

    if (outcome.skipped !== "cooldown") {
      captureServerEvent(String(trip.user_id ?? "system"), "photos_enriched", {
        trip_id: tripId,
        trigger,
        skipped: outcome.skipped,
        real_before: outcome.before.real,
        real_after: outcome.after.real,
        total_activities: outcome.after.total,
        paid_budget: maxPaidLookups,
      }).catch(() => {});
    }

    return outcome;
  } catch (err) {
    console.error(`[enrichTrip] ${trigger} enrichment failed for ${tripId}:`, err);
    return null;
  }
}
