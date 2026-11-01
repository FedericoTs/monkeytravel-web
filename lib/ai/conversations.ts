/**
 * Which chat a row of `ai_conversations` belongs to, in `context.surface`.
 * The concierge stores one row per question; the trip assistant keeps one
 * thread per conversation (older threads carry no mark). Each chat reads only
 * its own rows.
 */
export const CONCIERGE_SURFACE = "concierge_f4";
export const ASSISTANT_SURFACE = "trip_assistant";

export function isConciergeRow(context: unknown): boolean {
  return (context as { surface?: unknown } | null | undefined)?.surface === CONCIERGE_SURFACE;
}
