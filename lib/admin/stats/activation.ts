import type { AdminStats } from "./types";

type RowsRead<T> = { data: T[] | null; error: { message: string } | null };

// ---- Activation block --------------------------------------------------
//
// Replaces the old "churn" card. Tells the real activation story:
//   1. How many signups created their first trip?  (signupToFirstTripPct)
//   2. Of trip-creators, how many came back for a 2nd?  (multiTripPct)
//   3. Of all trips, how many were shared?  (sharedTripPct)
//   4. Who's at risk?  (signed up, never created a trip, dormant > 7d)
//
// All derived from existing columns. No schema change.
export function activationStats(
  tripRows: RowsRead<{ user_id: string | null }>,
  userRows: RowsRead<{ id: string; created_at: string }>,
  totalUsers: number,
  usersWithTrips: number,
  totalTrips: number,
  sharedTrips: number,
  activeUserIds7d: Set<string>,
): AdminStats["activation"] {
  // If either read failed, a zero-filled block instead of 500'ing the whole /admin page.
  const empty: AdminStats["activation"] = {
    signupToFirstTripPct:
      totalUsers > 0 ? Math.round((usersWithTrips / totalUsers) * 1000) / 10 : 0,
    multiTripUsers: 0,
    multiTripPct: 0,
    sharedTripPct:
      totalTrips > 0 ? Math.round((sharedTrips / totalTrips) * 1000) / 10 : 0,
    atRiskUsers: 0,
  };

  try {
    const d7AgoIso = new Date(Date.now() - 7 * 86_400_000).toISOString();

    // multiTripUsers + the trip-owner set (reused for at-risk exclusion).
    if (tripRows.error) throw tripRows.error;
    const tripOwners = tripRows.data ?? [];
    const counts = new Map<string, number>();
    tripOwners.forEach((t) => {
      if (!t.user_id) return;
      counts.set(t.user_id, (counts.get(t.user_id) ?? 0) + 1);
    });
    let multiTripUsers = 0;
    for (const c of counts.values()) {
      if (c >= 2) multiTripUsers++;
    }

    // atRiskUsers: signed up >7d ago, never created a trip, and no tracked
    // activity in the last 7 days. Uses the activity proxy (last_sign_in_at is
    // never synced, so the old NULL-aware sign-in filter flagged everyone).
    if (userRows.error) throw userRows.error;
    const dormant = (userRows.data ?? []).filter((u) => u.created_at < d7AgoIso);

    const tripOwnerSet = new Set(
      tripOwners.map((t) => t.user_id).filter((id): id is string => !!id),
    );
    let atRiskUsers = 0;
    dormant.forEach((u) => {
      if (!tripOwnerSet.has(u.id) && !activeUserIds7d.has(u.id)) atRiskUsers++;
    });

    const signupToFirstTripPct =
      totalUsers > 0 ? Math.round((usersWithTrips / totalUsers) * 1000) / 10 : 0;
    const multiTripPct =
      usersWithTrips > 0 ? Math.round((multiTripUsers / usersWithTrips) * 1000) / 10 : 0;
    const sharedTripPct =
      totalTrips > 0 ? Math.round((sharedTrips / totalTrips) * 1000) / 10 : 0;

    return {
      signupToFirstTripPct,
      multiTripUsers,
      multiTripPct,
      sharedTripPct,
      atRiskUsers,
    };
  } catch (err) {
    console.error("[Admin Stats] activation failed:", err);
    return empty;
  }
}
