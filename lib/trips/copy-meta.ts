/**
 * A trip's trip_meta for a copy (duplicate, fork), without what belongs to the
 * source's owner and history: claimed_at / claimed_from mark a trip that began
 * signed-out (read by get_anonymous_loop, so a copy would count as another
 * claim), and packing_checked is what that owner already packed.
 */
export function copyableTripMeta(meta: unknown): unknown {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return meta;
  const { claimed_at, claimed_from, packing_checked, ...rest } = meta as Record<string, unknown>;
  void claimed_at;
  void claimed_from;
  void packing_checked;
  return rest;
}
