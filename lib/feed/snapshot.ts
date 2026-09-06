import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ItineraryDay } from "@/types";
import { sortFeed, type FeedEvent } from "./shared";
import type { SwapSuggestion } from "@/lib/today/actions";
import { todayActionsSnapshot } from "@/lib/today/snapshot";
import { expensesSnapshot } from "@/lib/expenses/snapshot";

/** How many events the feed carries. Enough to feel alive, short enough to scan. */
export const FEED_LIMIT = 12;

interface FeedTrip {
  id: string;
  user_id: string | null;
  itinerary: ItineraryDay[] | null;
}

/**
 * The Today activity feed for one trip — participant joins, chip actions
 * (Phase 3.3) and expenses (Phase 3.4) merged into one chronological stream,
 * newest first, capped. Service-role read behind the /shared route's token
 * check; reuses the existing per-source snapshots so the feed and the panels
 * never disagree. Activity ids are resolved to names here so the client needs
 * only the itinerary it already has. Live Trip Phase 3.5.
 */
export async function feedSnapshot(
  admin: SupabaseClient,
  trip: FeedTrip,
  viewerCookieId: string | undefined,
  viewerUserId: string | null,
  limit: number = FEED_LIMIT,
): Promise<FeedEvent[]> {
  const nameOf = activityNameResolver(trip.itinerary);
  const events: FeedEvent[] = [];

  // 1. Participant joins — named only ("someone is going" is noise, not signal).
  const { data: parts, error: pErr } = await admin
    .from("trip_participants")
    .select("id, display_name, joined_at")
    .eq("trip_id", trip.id)
    .is("left_at", null);
  if (pErr) console.error("[feed] participants read failed:", pErr);
  for (const p of parts ?? []) {
    const name = (p.display_name as string | null)?.trim();
    if (!name) continue;
    events.push({
      id: `join:${p.id}`,
      kind: "join",
      at: p.joined_at as string,
      actorName: name,
      actorIsOwner: false,
      activityName: null,
    });
  }

  // 2. Chip actions — reuse the Today snapshot (active only, no cookie ids).
  const actions = await todayActionsSnapshot(admin, trip.id, viewerCookieId, viewerUserId);
  for (const a of actions) {
    if (a.action_type === "running_late") {
      events.push({
        id: `act:${a.id}`,
        kind: "running_late",
        at: a.created_at,
        actorName: a.actor_name,
        actorIsOwner: a.actor_role === "owner",
        activityName: null,
        minutes: typeof a.payload?.minutes === "number" ? a.payload.minutes : undefined,
      });
    } else if (a.action_type === "swap") {
      events.push({
        id: `act:${a.id}`,
        kind: "swap",
        at: a.created_at,
        actorName: a.actor_name,
        actorIsOwner: a.actor_role === "owner",
        activityName: nameOf(a.activity_id),
        swapTo: (a.payload?.swap_to as SwapSuggestion | undefined)?.name ?? null,
      });
    } else {
      // skip | done
      events.push({
        id: `act:${a.id}`,
        kind: a.action_type,
        at: a.created_at,
        actorName: a.actor_name,
        actorIsOwner: a.actor_role === "owner",
        activityName: nameOf(a.activity_id),
      });
    }
  }

  // 3. Expenses — reuse the ledger snapshot (authed + anonymous; paidByIsOwner
  //    already resolved). The viewer summary it also computes is ignored here.
  const { expenses } = await expensesSnapshot(admin, trip.id, trip.user_id, viewerUserId, viewerCookieId);
  for (const e of expenses) {
    events.push({
      id: `exp:${e.id}`,
      kind: "expense",
      at: e.createdAt,
      actorName: e.paidByName,
      actorIsOwner: e.paidByIsOwner,
      activityName: nameOf(e.activityId),
      amountCents: e.amountCents,
      currency: e.currency,
    });
  }

  return sortFeed(events).slice(0, limit);
}

function activityNameResolver(itinerary: ItineraryDay[] | null): (id: string | null) => string | null {
  const byId = new Map<string, string>();
  for (const day of itinerary ?? []) {
    for (const a of day.activities ?? []) {
      if (a.id && a.name) byId.set(a.id, a.name);
    }
  }
  return (id) => (id ? byId.get(id) ?? null : null);
}
