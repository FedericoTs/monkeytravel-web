/**
 * Self-heal dedupe for /api/places/photo.
 *
 * WHY THIS EXISTS (measured 2026-09-13, api_request_logs, 14 days)
 * Google photo resource names die after ~29 days, and 4,851 of the 7,811 refs
 * in places_v2 were already dead. The render-time self-heal in
 * app/api/places/photo/route.ts repairs a dead ref on first view with one
 * Place Details call ($0.017), which is the lazy model working as intended:
 * pay when someone actually looks.
 *
 * What was not intended: 772 of the fortnight's 2,268 photo-detail calls
 * ($13.12 of $38.56) were heals, and the Vercel logs showed the SAME place
 * healed four times in the same second (a page loads the photo at several
 * sizes, each a different URL, each a CDN miss) and again minutes later from
 * another region. Over one two-hour window: 20 heals for 6 distinct places.
 * Every duplicate bought the answer we already had.
 *
 * Two guards, both free:
 *   1. InFlight — concurrent heals for the same place inside one function
 *      instance share a single Google call.
 *   2. reusableFreshRef — before paying, re-read places_v2: if a save-time
 *      pass or an earlier heal already stored a DIFFERENT ref within the last
 *      HEAL_REUSE_MAX_AGE_DAYS, serve that one. The heal's own cache write
 *      makes this true for every later request from every region.
 *
 * Pure and dependency-free so the decision is unit-tested; the route supplies
 * the database read and the Google call.
 */

/**
 * Mirrors PHOTO_REF_MAX_AGE_DAYS in lib/images/activity.ts: a ref refreshed
 * more recently than this is trusted without another Google call. Google's
 * measured lifetime is ~29 days (2026-07-21 probe), so 21 keeps the same
 * ~8-day margin the enrichment path uses.
 */
export const HEAL_REUSE_MAX_AGE_DAYS = 21;

export interface CachedPhotoRow {
  photo_resource_name: string | null;
  photo_url: string | null;
  updated_at: string | null;
}

export interface FreshPhoto {
  photo_resource_name: string;
  photo_url: string;
}

/**
 * The cached row can stand in for a paid heal when it already carries a
 * different, recently refreshed ref. Returns null when the row is missing,
 * still holds the dead ref, or is old enough that its ref may be dead too.
 */
export function reusableFreshRef(
  row: CachedPhotoRow | null | undefined,
  deadName: string,
  now: number = Date.now()
): FreshPhoto | null {
  if (!row?.photo_resource_name || !row.photo_url) return null;
  if (row.photo_resource_name === deadName) return null;
  const refreshedAt = row.updated_at ? Date.parse(row.updated_at) : Number.NaN;
  if (Number.isNaN(refreshedAt)) return null;
  const ageMs = now - refreshedAt;
  if (ageMs < 0 || ageMs >= HEAL_REUSE_MAX_AGE_DAYS * 86_400_000) return null;
  return { photo_resource_name: row.photo_resource_name, photo_url: row.photo_url };
}

/**
 * Coalesce concurrent async work by key: the first caller runs `fn`, every
 * caller that arrives before it settles shares the same promise, and the key
 * is released as soon as it settles (success or failure) so a later request
 * starts fresh.
 */
export class InFlight<T> {
  private readonly pending = new Map<string, Promise<T>>();

  run(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.pending.get(key);
    if (existing) return existing;
    const p = fn().finally(() => {
      this.pending.delete(key);
    });
    this.pending.set(key, p);
    return p;
  }

  get size(): number {
    return this.pending.size;
  }
}
