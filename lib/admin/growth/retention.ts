import type { GrowthRows, GrowthUser } from "./rows";
import type { GrowthStats } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/**
 * Who came back, from what we record. public.users.last_sign_in_at is a mirror of
 * auth.users that nothing syncs, so it can't carry retention alone. It's used when
 * present, alongside trips, AI conversations and banana transactions.
 */
export interface ActivitySignals {
  /** Most recent activity: "still active". */
  lastActivityByUser: Map<string, number>;
  /** Earliest activity after signup: "came back within N days". */
  earliestReturnByUser: Map<string, number>;
  signInTrackingAvailable: boolean;
}

export function activitySignals({ users, trips, aiConversations, bananaTransactions }: GrowthRows): ActivitySignals {
  const createdByUser = new Map<string, number>();
  users.forEach((u) => {
    const created = new Date(u.created_at).getTime();
    if (!Number.isNaN(created)) createdByUser.set(u.id, created);
  });
  const lastActivityByUser = new Map<string, number>();
  const earliestReturnByUser = new Map<string, number>();
  const consider = (uid?: string | null, iso?: string | null) => {
    if (!uid || !iso) return;
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return;
    if (t > (lastActivityByUser.get(uid) || 0)) lastActivityByUser.set(uid, t);
    const created = createdByUser.get(uid);
    if (created != null && t > created) {
      const current = earliestReturnByUser.get(uid);
      if (current == null || t < current) earliestReturnByUser.set(uid, t);
    }
  };
  users.forEach((u) => consider(u.id, u.last_sign_in_at));
  trips.forEach((t) => consider(t.user_id, t.created_at));
  aiConversations.forEach((c) => consider(c.user_id, c.created_at));
  bananaTransactions.forEach((b) => consider(b.user_id, b.created_at));
  return {
    lastActivityByUser,
    earliestReturnByUser,
    signInTrackingAvailable: users.some((u) => u.last_sign_in_at != null),
  };
}

/** Whether their first activity after signup came within `days` of it. */
function cameBackWithin(user: GrowthUser, days: number, signals: ActivitySignals): boolean {
  const firstReturn = signals.earliestReturnByUser.get(user.id);
  if (!firstReturn) return false;
  const daysSinceSignup = (firstReturn - new Date(user.created_at).getTime()) / DAY_MS;
  return daysSinceSignup > 0 && daysSinceSignup <= days;
}

export function retentionStats(users: GrowthUser[], signals: ActivitySignals, now: Date): GrowthStats["retention"] {
  const returnRate = (signups: GrowthUser[], days: number) =>
    percent(signups.filter((u) => cameBackWithin(u, days, signals)).length, signups.length);
  const daysAgo = (days: number) => new Date(now.getTime() - days * DAY_MS);

  // Everyone old enough to have had the window.
  const current = (days: number) => {
    const eligible = users.filter((u) => new Date(u.created_at) < daysAgo(days));
    return { rate: returnRate(eligible, days), eligible: eligible.length };
  };
  // The signups one window before that, to compare with.
  const previous = (days: number) =>
    returnRate(
      users.filter((u) => {
        const created = new Date(u.created_at);
        return created < daysAgo(days) && created >= daysAgo(days * 2);
      }),
      days
    );

  const d1 = current(1);
  const d7 = current(7);
  const d30 = current(30);
  return {
    d1: d1.rate,
    d7: d7.rate,
    d30: d30.rate,
    d1Change: d1.rate - previous(1),
    d7Change: d7.rate - previous(7),
    d30Change: d30.rate - previous(30),
    sampleSizes: { d1Eligible: d1.eligible, d7Eligible: d7.eligible, d30Eligible: d30.eligible },
  };
}

/** D7 retention of those who did something against those who didn't, among signups old enough to tell. */
export function ahaMomentStats(rows: GrowthRows, signals: ActivitySignals, now: Date): GrowthStats["ahaMoments"] {
  const { users, trips, aiConversations, invites, collaborators, proposalVotes, proposals } = rows;
  const eligible = users.filter((u) => new Date(u.created_at) < new Date(now.getTime() - 7 * DAY_MS));
  const d7Retention = (signups: GrowthUser[]) =>
    percent(signups.filter((u) => cameBackWithin(u, 7, signals)).length, signups.length);

  const moment = (userIds: Array<string | null>) => {
    const didIt = new Set(userIds);
    const didItRetention = d7Retention(eligible.filter((u) => didIt.has(u.id)));
    const didntDoItRetention = d7Retention(eligible.filter((u) => !didIt.has(u.id)));
    const retentionLift =
      didntDoItRetention > 0
        ? Math.round(((didItRetention - didntDoItRetention) / didntDoItRetention) * 100)
        : didItRetention > 0
          ? 100
          : 0;
    return { didIt: didItRetention, didntDoIt: didntDoItRetention, retentionLift };
  };

  return {
    generatedItinerary: moment(trips.map((t) => t.user_id)),
    sharedTrip: moment(trips.filter((t) => t.share_token).map((t) => t.user_id)),
    completedOnboarding: moment(users.filter((u) => u.onboarding_completed).map((u) => u.id)),
    usedAssistant: moment(aiConversations.map((c) => c.user_id)),
    createdInvite: moment(invites.map((i) => i.created_by)),
    joinedViaInvite: moment(collaborators.filter((c) => c.invited_by).map((c) => c.user_id)),
    votedOnProposal: moment(proposalVotes.map((v) => v.user_id)),
    createdProposal: moment(proposals.map((p) => p.proposed_by)),
  };
}
