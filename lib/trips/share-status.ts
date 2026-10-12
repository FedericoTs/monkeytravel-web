/** What GET /api/trips/{id}/share answers, as far as the trip page reads it. */
export interface ShareStatus {
  isShared?: boolean;
  shareUrl?: string | null;
  shareToken?: string | null;
  isInTrending?: boolean;
  exploreEnabled?: boolean;
}

/**
 * The trip page, its ShareButton and its share prompt each asked for the share
 * status on mount, three requests for one answer. They now share one: a request
 * in flight, or settled less than REUSE_MS ago (the prompt mounts once its chunk
 * has loaded), answers every caller. A share-state change forgets it.
 */
const REUSE_MS = 10_000;
const recent = new Map<string, { at: number; status: Promise<ShareStatus | null> }>();

/** The share status, or null when the route refuses (not signed in, no access). */
export function fetchShareStatus(tripId: string, { fresh = false }: { fresh?: boolean } = {}): Promise<ShareStatus | null> {
  const hit = recent.get(tripId);
  if (!fresh && hit && Date.now() - hit.at < REUSE_MS) return hit.status;
  const status = fetch(`/api/trips/${tripId}/share`).then((r) => (r.ok ? (r.json() as Promise<ShareStatus>) : null));
  recent.set(tripId, { at: Date.now(), status });
  // A failed request answers its callers but not later ones.
  status.catch(() => {
    if (recent.get(tripId)?.status === status) recent.delete(tripId);
  });
  return status;
}

/** After sharing is turned on or off; without a trip id, forgets every trip. */
export function forgetShareStatus(tripId?: string): void {
  if (tripId) recent.delete(tripId);
  else recent.clear();
}
