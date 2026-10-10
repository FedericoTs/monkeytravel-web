import type { SupabaseClient } from "@supabase/supabase-js";
import type { Activity, ItineraryDay, ProposalResolutionMethod } from "@/types";
import { casUpdateItinerary, type ItineraryRow } from "@/lib/trips/itinerary-cas";
import { chronologicalInsertIndex } from "@/lib/utils/activity-id";

/**
 * The one approval path, for the owner's approve and for the crew's votes:
 * the proposal's activity goes into the trip first (compare-and-set on
 * itinerary_version), then the proposal is marked approved. A failure leaves
 * the proposal open, so approving again is safe: the activity's id comes from
 * the proposal, and an activity already in the trip is not added twice.
 */

export interface ApprovableProposal {
  id: string;
  trip_id: string;
  /** The day's day_number (1-based). */
  target_day: number;
  activity_data: unknown;
}

export type ApproveOutcome =
  | { ok: true }
  | { ok: false; reason: "no_day" | "busy" | "not_found" | "resolved" | "error" };

/** The itinerary id of a proposal's activity: the same for every run of one proposal. */
export function proposalActivityId(proposalId: string): string {
  return `act_${proposalId.replace(/-/g, "").slice(0, 12)}`;
}

/**
 * The itinerary with the proposal's activity on its day, in time order;
 * "present" when the trip already has it, "no_day" when its day is gone.
 */
export function addProposalActivity(
  itinerary: unknown,
  proposal: ApprovableProposal
): ItineraryDay[] | "present" | "no_day" {
  const days = (Array.isArray(itinerary) ? itinerary : []) as ItineraryDay[];
  const id = proposalActivityId(proposal.id);
  if (days.some((d) => Array.isArray(d?.activities) && d.activities.some((a) => a?.id === id))) return "present";

  const dayIndex = days.findIndex((d) => d?.day_number === proposal.target_day);
  if (dayIndex === -1) return "no_day";

  const day = days[dayIndex];
  const current = Array.isArray(day.activities) ? day.activities : [];
  const activity: Activity = { ...(proposal.activity_data as Activity), id };
  const at = chronologicalInsertIndex({ ...day, activities: current }, activity.start_time);
  const next = days.slice();
  next[dayIndex] = { ...day, activities: [...current.slice(0, at), activity, ...current.slice(at)] };
  return next;
}

/** Runs with the service role: the caller has already checked who may approve. */
export async function approveProposal(
  admin: SupabaseClient,
  proposal: ApprovableProposal,
  resolution: { method: ProposalResolutionMethod; resolvedBy: string | null }
): Promise<ApproveOutcome> {
  try {
    const { data: trip, error: readError } = await admin
      .from("trips")
      .select("itinerary, itinerary_version")
      .eq("id", proposal.trip_id)
      .maybeSingle();
    if (readError) throw readError;
    if (!trip) return { ok: false, reason: "not_found" };

    // Set inside the change callback; the cast keeps TS from narrowing it.
    let noDay = false as boolean;
    const written = await casUpdateItinerary(admin, {
      tripId: proposal.trip_id,
      from: trip as ItineraryRow,
      change: (row) => {
        const next = addProposalActivity(row.itinerary, proposal);
        noDay = next === "no_day";
        return Array.isArray(next) ? { itinerary: next } : null;
      },
    });
    if (written.status === "busy") return { ok: false, reason: "busy" };
    if (written.status === "missing") return { ok: false, reason: "not_found" };
    if (written.status === "skipped" && noDay) return { ok: false, reason: "no_day" };

    // Only an open proposal becomes approved. No row: someone resolved it meanwhile.
    const { data: rows, error: statusError } = await admin
      .from("activity_proposals")
      .update({
        status: "approved",
        resolved_at: new Date().toISOString(),
        resolved_by: resolution.resolvedBy,
        resolution_method: resolution.method,
      })
      .eq("id", proposal.id)
      .in("status", ["pending", "voting"])
      .select("id");
    if (statusError) throw statusError;
    if (rows?.length) return { ok: true };

    const { data: now } = await admin.from("activity_proposals").select("status").eq("id", proposal.id).maybeSingle();
    return now?.status === "approved" ? { ok: true } : { ok: false, reason: "resolved" };
  } catch (error) {
    console.error("[proposals] approval failed", {
      proposalId: proposal.id,
      error: error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error),
    });
    return { ok: false, reason: "error" };
  }
}
