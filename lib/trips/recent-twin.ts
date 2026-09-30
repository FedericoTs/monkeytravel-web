import type { SupabaseClient } from "@supabase/supabase-js";
import { getTripDestination } from "@/lib/trips/destination";
import { isSameDestination } from "@/lib/trips/sameDestination";

/** How far back a saved trip counts as the one being planned again. */
export const TWIN_WINDOW_DAYS = 7;

export interface RecentTwin {
  id: string;
  title: string;
}

/**
 * A trip this account saved in the last week for the same place and dates.
 * Planning it again in a fresh wizard would otherwise auto-save a second copy
 * under the same name, and edits then land on whichever copy is open.
 * Any error reads as "no twin": the save goes ahead as before.
 */
export async function findRecentTwin(
  supabase: SupabaseClient,
  userId: string,
  trip: { destination: string; startDate: string; endDate: string },
  now: Date = new Date(),
): Promise<RecentTwin | null> {
  if (!trip.destination || !trip.startDate || !trip.endDate) return null;
  const since = new Date(now.getTime() - TWIN_WINDOW_DAYS * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("trips")
    .select("id, title, trip_meta")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .eq("start_date", trip.startDate)
    .eq("end_date", trip.endDate)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error || !data) return null;
  const match = data.find((row) => isSameDestination(getTripDestination(row), trip.destination));
  return match ? { id: match.id, title: match.title } : null;
}
