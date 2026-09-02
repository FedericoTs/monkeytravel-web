/**
 * Which persistence path owns a signed-out planner's itinerary once they sign in?
 *
 * A planner who shares while signed out mints an ownerless trip row and their
 * browser keeps a claim token (lib/trips/anonymous-claim-client.ts). When they
 * sign in, two things would persist the same itinerary at once: AuthProvider
 * claims that row, and the wizard's auto-save inserts a fresh one. Measured
 * 2026-09-02: 56 signed-out shares in 30 days, 0 claims, so the collision had
 * never been seen — the "keep this trip" nudge makes it routine, so the rule
 * is pinned here and tested, away from the 4,000-line wizard.
 *
 *   matches     the draft on screen is the trip that was shared (same
 *               destination and dates)
 *   unresolved  the claim has not reported yet
 *   adopted     the claim returned the trip; it IS the saved trip now
 *   released    the claim came back empty (expired, already taken, no token);
 *               auto-save owns persistence again
 */

export interface PendingClaimDraftKey {
  destination: string;
  startDate: string;
  endDate: string;
}

export type ClaimResolution = "none" | "unresolved" | "adopted" | "released";

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

/** Same trip: destination (case/whitespace-insensitive) and both dates equal. Empty drafts never match. */
export function pendingClaimMatchesDraft(
  pending: PendingClaimDraftKey | null | undefined,
  draft: PendingClaimDraftKey | null | undefined,
): boolean {
  if (!pending || !draft) return false;
  if (!norm(draft.destination) || !draft.startDate || !draft.endDate) return false;
  return (
    norm(pending.destination) === norm(draft.destination) &&
    pending.startDate === draft.startDate &&
    pending.endDate === draft.endDate
  );
}

/**
 * Auto-save must wait while the shared trip is on screen and the claim has
 * not reported. Once adopted the hook is handed the id; once released it
 * inserts as usual. A non-matching draft is a different trip and saves
 * normally even while an unrelated claim is pending.
 */
export function shouldDeferAutoSave(input: { matches: boolean; resolution: ClaimResolution }): boolean {
  return input.matches && input.resolution === "unresolved";
}
