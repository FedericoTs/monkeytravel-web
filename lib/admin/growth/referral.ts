import type { GrowthRows } from "./rows";
import type { GrowthStats } from "./types";

/** Who shares, how far it travels, and what comes back (the Sean Ellis framework). */
export function referralStats({ users, trips, referralCodes, invites, anonVotes }: GrowthRows): GrowthStats["referral"] {
  // People without a trip can't share one, so they aren't in the denominators.
  const usersWithTrips = new Set(trips.map((t) => t.user_id)).size;

  // What people do.
  const sharedTrips = trips.filter((t) => t.share_token != null);
  const totalTripShares = sharedTrips.length;
  const usersWhoShared = new Set(sharedTrips.map((t) => t.user_id).filter(Boolean)).size;
  const shareRate = usersWithTrips > 0 ? Math.round((usersWhoShared / usersWithTrips) * 100) : 0;

  // How far it goes. Distinct anonymous voters on shared trips are the reach signal;
  // trip_views counts everyone who opens a trip, its owner included.
  const anonymousEngagers = new Set(anonVotes.map((v) => v.voter_cookie_id).filter(Boolean)).size;
  const sharedTripsWithEngagement = new Set(anonVotes.map((v) => v.trip_id).filter(Boolean)).size;
  const totalReferralClicks = referralCodes.reduce((sum, c) => sum + (c.total_clicks || 0), 0);

  // What comes back. Conversion is from referral clicks only: those are explicit
  // invitations, and a view of a shared trip is not.
  const referredSignups = users.filter((u) => u.referred_by_code != null).length;
  const conversionRate = totalReferralClicks > 0 ? Math.round((referredSignups / totalReferralClicks) * 100) : 0;

  // K = (shares per user) × (signups per share). Above 1, each user brings more than one.
  const sharesPerUser = usersWithTrips > 0 ? Math.round((totalTripShares / usersWithTrips) * 10000) / 10000 : 0;
  const signupsPerShare = totalTripShares > 0 ? referredSignups / totalTripShares : 0;
  const kFactor = Math.round(sharesPerUser * signupsPerShare * 10000) / 10000;

  return {
    totalTripShares,
    usersWhoShared,
    shareRate,
    totalShareViews: anonymousEngagers,
    anonymousEngagers,
    sharedTripsWithEngagement,
    totalReferralClicks,
    referredSignups,
    conversionRate,
    kFactor,
    sharesPerUser,
    topReferrers: topReferrers({ users, sharedTrips, referralCodes, invites }),
  };
}

/** The champions: shares, invites and referred signups, a signup counting most. */
function topReferrers({
  users,
  sharedTrips,
  referralCodes,
  invites,
}: Pick<GrowthRows, "users" | "referralCodes" | "invites"> & { sharedTrips: GrowthRows["trips"] }) {
  const countBy = (ids: Array<string | null>) => {
    const counts = new Map<string, number>();
    ids.forEach((id) => {
      if (id) counts.set(id, (counts.get(id) || 0) + 1);
    });
    return counts;
  };
  const shares = countBy(sharedTrips.map((t) => t.user_id));
  const inviteCounts = countBy(invites.map((i) => i.created_by));
  const signups = new Map<string, number>();
  referralCodes.forEach((c) => {
    if ((c.total_signups ?? 0) > 0) signups.set(c.user_id, c.total_signups as number);
  });

  const userById = new Map(users.map((u) => [u.id, u]));
  return Array.from(new Set([...shares.keys(), ...signups.keys(), ...inviteCounts.keys()]))
    .map((userId) => {
      const user = userById.get(userId);
      return {
        name: user?.display_name || user?.id?.slice(0, 8) || "Unknown",
        shares: shares.get(userId) || 0,
        invites: inviteCounts.get(userId) || 0,
        signups: signups.get(userId) || 0,
      };
    })
    .sort((a, b) => b.shares + b.invites * 2 + b.signups * 10 - (a.shares + a.invites * 2 + a.signups * 10))
    .slice(0, 5);
}
