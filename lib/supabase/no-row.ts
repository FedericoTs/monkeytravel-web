/**
 * A read that found nothing, as opposed to one the database refused:
 * `.single()` on zero rows (PGRST116), or an id that is not a valid uuid
 * (22P02), which can match no row.
 */
export function isNoRow(error: { code?: string } | null | undefined): boolean {
  return error?.code === "PGRST116" || error?.code === "22P02";
}
