import type { SupabaseClient } from "@supabase/supabase-js";
import { CONCIERGE_SURFACE } from "@/lib/ai/conversations";
import { errors } from "@/lib/api/response-wrapper";
import { createAdminClient } from "@/lib/supabase/admin";
import { logReadError } from "@/lib/supabase/log-read-error";
import { getTripDestination } from "@/lib/trips/destination";
import type { ItineraryDay, TripMeta } from "@/types";

/** What the concierge knows before it answers: the trip, today, and its last few turns. */
export type ConciergeTrip = {
  id: string;
  title?: string;
  // The canonical destination lives in trip_meta.destination: there is no
  // trips.destination column. getTripDestination() reads it with a title-strip
  // fallback.
  trip_meta?: TripMeta | null;
  start_date: string;
  end_date: string;
  itinerary?: unknown;
  /** Currency source for sanitized proposal activities. */
  budget?: { currency?: string } | null;
};

export type TodaySlice = { dayNumber: number; activities: ItineraryDay["activities"] };
export type ConciergeTurn = { question: string; answer: string };

/**
 * Per-process trip memo. Travellers fire 2-3 follow-up questions in a row about
 * the same open trip, and the trip rarely changes between them, so each needn't
 * read the full itinerary again.
 *
 * Keyed by user, so collaborators on a shared trip don't see each other's RLS view
 * (RLS ran for this user when the row was first read), and by the client's edit
 * counter, so a question after an applied proposal misses the pre-edit row. 60s is
 * short enough that other edits show quickly, long enough to catch the follow-ups.
 * No coherence across instances: a stale read is at worst 60s old.
 */
const TRIP_CACHE_TTL_MS = 60_000;
const tripContextCache = new Map<string, { row: ConciergeTrip; expiresAt: number }>();

function getCachedTrip(key: string): ConciergeTrip | null {
  const entry = tripContextCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    tripContextCache.delete(key);
    return null;
  }
  return entry.row;
}

/**
 * The trip, for its owner or a collaborator (RLS handles that filter), with only
 * the fields the prompt needs, to keep tokens down.
 */
export async function loadConciergeTrip(
  supabase: SupabaseClient,
  userId: string,
  tripId: string,
  itineraryVersion: number
): Promise<{ trip: ConciergeTrip; errorResponse: null } | { trip: null; errorResponse: Response }> {
  const key = `${userId}|${tripId}|${itineraryVersion}`;
  const cached = getCachedTrip(key);
  if (cached) return { trip: cached, errorResponse: null };

  const { data: row, error } = await supabase
    .from("trips")
    .select("id, title, start_date, end_date, itinerary, trip_meta, budget")
    .eq("id", tripId)
    .maybeSingle();
  if (error) {
    console.error("[concierge] trip load failed", error);
    return { trip: null, errorResponse: errors.internal("Failed to load trip context", "concierge") };
  }
  if (!row) {
    return { trip: null, errorResponse: errors.notFound("Trip not found or you don't have access to it") };
  }
  const trip = row as ConciergeTrip;
  tripContextCache.set(key, { row: trip, expiresAt: Date.now() + TRIP_CACHE_TTL_MS });
  return { trip, errorResponse: null };
}

/**
 * Today's completion state from activity_timelines, so "what's left today?" and
 * "we're behind" have ground truth. Best-effort: an empty map only means the
 * answer doesn't know, and never blocks it.
 */
export async function loadDayProgress(supabase: SupabaseClient, tripId: string, dayNumber: number): Promise<Map<string, string>> {
  try {
    const { data } = logReadError(
      "concierge: activity progress",
      await supabase.from("activity_timelines").select("activity_id, status").eq("trip_id", tripId).eq("day_number", dayNumber)
    );
    return new Map((data ?? []).map((r) => [String(r.activity_id), String(r.status)]));
  } catch (err) {
    console.warn("[concierge] timeline fetch failed (non-fatal)", err);
    return new Map();
  }
}

/**
 * The last few persisted turns, oldest first, so "make it shorter" after "propose a
 * dinner spot" resolves. The user_id and trip_id filters scope it to this user's
 * own concierge turns.
 */
export async function loadConciergeMemory(userId: string, tripId: string): Promise<ConciergeTurn[]> {
  try {
    const { data } = logReadError(
      "concierge: history",
      await createAdminClient()
        .from("ai_conversations")
        .select("messages")
        .eq("user_id", userId)
        .eq("trip_id", tripId)
        .eq("context->>surface", CONCIERGE_SURFACE)
        .order("created_at", { ascending: false })
        .limit(3)
    );
    return (data ?? [])
      .map((r) => {
        const msgs = r.messages as { role?: string; content?: string }[] | null;
        const q = msgs?.find((m) => m.role === "user")?.content;
        const a = msgs?.find((m) => m.role === "assistant")?.content;
        return q && a ? { question: q, answer: a } : null;
      })
      .filter((t): t is ConciergeTurn => t !== null)
      .reverse();
  } catch (err) {
    console.warn("[concierge] history fetch failed (non-fatal)", err);
    return [];
  }
}

/**
 * Today's place in the trip; null before the trip starts or after it ends, when
 * questions are still answered, without the "today" framing. The traveller's local
 * date wins: the server's UTC is already tomorrow for evening users in the Americas.
 * Trip dates are stored at UTC midnight, so the comparison is in whole UTC days.
 */
export function resolveTodaySlice(
  startDate: string,
  endDate: string,
  itinerary: ItineraryDay[],
  clientToday?: string | null
): TodaySlice | null {
  let today: number;
  const m = clientToday ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(clientToday) : null;
  if (m) {
    today = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  } else {
    const now = new Date();
    today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  }
  const start = new Date(startDate);
  const startUtc = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const end = new Date(endDate);
  const endUtc = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  if (today < startUtc || today > endUtc) return null;

  const diffDays = Math.floor((today - startUtc) / (24 * 60 * 60 * 1000));
  const dayNumber = diffDays + 1; // 1-indexed
  const day = itinerary.find((d) => d.day_number === dayNumber);
  if (!day) return { dayNumber, activities: [] };
  return { dayNumber, activities: day.activities ?? [] };
}

/**
 * A compact JSON context for the prompt, without the fields the model doesn't need
 * (timestamps, image URLs). Ids are what the edit-proposal protocol targets, and
 * locked tells the model which activities are the traveller's own fixed plans.
 */
export function buildTripContext(
  trip: Pick<ConciergeTrip, "title" | "trip_meta" | "start_date" | "end_date" | "itinerary">,
  todaySlice: TodaySlice | null,
  completionByActivityId: Map<string, string> = new Map()
): string {
  const days = Array.isArray(trip.itinerary)
    ? (trip.itinerary as ItineraryDay[]).map((d) => ({
        day_number: d.day_number,
        date: d.date,
        activities: (d.activities ?? []).map((a) => ({
          id: a.id,
          time_slot: a.time_slot,
          start_time: a.start_time,
          name: a.name,
          type: a.type,
          location: a.location || a.address || undefined,
          duration_minutes: a.duration_minutes,
          ...((a as { locked?: boolean }).locked === true ? { locked: true } : {}),
        })),
      }))
    : [];

  const out: Record<string, unknown> = {
    title: trip.title,
    destination: getTripDestination({ title: trip.title, trip_meta: trip.trip_meta }),
    start_date: trip.start_date,
    end_date: trip.end_date,
    total_days: days.length,
    itinerary: days,
  };
  if (todaySlice) {
    out.today = {
      day_number: todaySlice.dayNumber,
      activities: todaySlice.activities.map((a) => ({
        id: a.id,
        time_slot: a.time_slot,
        start_time: a.start_time,
        name: a.name,
        type: a.type,
        location: a.location || a.address || undefined,
        // "completed" | "skipped"; absent means not started yet. This is what
        // makes "are we still on track?" answerable with ground truth.
        ...(a.id && completionByActivityId.has(a.id) ? { status: completionByActivityId.get(a.id) } : {}),
      })),
    };
  }
  return JSON.stringify(out);
}
