import type { SupabaseClient } from "@supabase/supabase-js";
import { getTripDestination } from "@/lib/trips/destination";
import { isSameDestination } from "@/lib/trips/sameDestination";

export interface RecentTwin {
  id: string;
  title: string;
}

/**
 * A trip this account already saved for the same place and dates. Planning it
 * again in a fresh wizard would otherwise auto-save a second copy under the
 * same name, and edits then land on whichever copy is open. No time window:
 * one place on the same dates is the same trip, however long ago it was
 * saved (a 7-day window missed people re-planning twelve days later).
 * A cancelled trip was set aside on purpose, so planning it again is a new trip.
 * Any error reads as "no twin": the save goes ahead as before.
 */
export async function findRecentTwin(
  supabase: SupabaseClient,
  userId: string,
  trip: { destination: string; startDate: string; endDate: string },
): Promise<RecentTwin | null> {
  if (!trip.destination || !trip.startDate || !trip.endDate) return null;
  const { data, error } = await supabase
    .from("trips")
    .select("id, title, trip_meta")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .neq("status", "cancelled")
    .eq("start_date", trip.startDate)
    .eq("end_date", trip.endDate)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error || !data) return null;
  const match = data.find((row) => isSameDestination(getTripDestination(row), trip.destination));
  return match ? { id: match.id, title: match.title } : null;
}
