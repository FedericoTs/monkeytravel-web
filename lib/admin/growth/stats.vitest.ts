import { describe, expect, it } from "vitest";
import type { GrowthRows, GrowthUser } from "./rows";
import { computeGrowthStats } from "./stats";

const NOW = new Date("2026-11-05T12:00:00.000Z");
const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

let serial = 0;
const nextId = (prefix: string) => `${prefix}-${++serial}`;

const user = (id: string, signedUpDaysAgo: number, extra: Partial<GrowthUser> = {}): GrowthUser => ({
  id,
  display_name: `Name ${id}`,
  created_at: daysAgo(signedUpDaysAgo),
  last_sign_in_at: null,
  onboarding_completed: false,
  subscription_tier: "free",
  is_pro: false,
  referred_by_code: null,
  banana_balance: 0,
  referral_tier: 0,
  show_on_leaderboard: true,
  leaderboard_visibility: "full",
  ...extra,
});
const trip = (userId: string | null, createdDaysAgo = 1, shared = false) => ({
  id: nextId("trip"),
  user_id: userId,
  created_at: daysAgo(createdDaysAgo),
  share_token: shared ? nextId("token") : null,
  is_template: false,
});
const banana = (userId: string, amount: number, createdDaysAgo = 1, extra: Record<string, unknown> = {}) => ({
  id: nextId("banana"),
  user_id: userId,
  amount,
  transaction_type: amount > 0 ? "referral" : "spend",
  created_at: daysAgo(createdDaysAgo),
  expires_at: null,
  expired: false,
  ...extra,
});

const stats = (rows: Partial<GrowthRows>, warnings: string[] = []) =>
  computeGrowthStats(
    {
      users: [],
      trips: [],
      referralCodes: [],
      aiConversations: [],
      collaborators: [],
      invites: [],
      proposals: [],
      proposalVotes: [],
      bananaTransactions: [],
      referralTiers: [],
      redemptionCatalog: [],
      bananaRedemptions: [],
      anonVotes: [],
      ...rows,
    },
    warnings,
    NOW
  );

describe("retention", () => {
  it("counts who came back within the window, among those old enough to have had it", () => {
    const { retention } = stats({
      users: [user("back-in-time", 10), user("back-too-late", 10), user("never-back", 10), user("too-new", 3)],
      trips: [trip("back-in-time", 5), trip("back-too-late", 1), trip("too-new", 1)],
    });
    expect(retention.sampleSizes).toEqual({ d1Eligible: 4, d7Eligible: 3, d30Eligible: 0 });
    expect(retention.d7).toBe(33);
    expect(retention.d30).toBe(0);
  });

  it("only takes activity after signup as coming back", () => {
    const { retention } = stats({
      users: [user("a", 10)],
      trips: [trip("a", 20)],
    });
    expect(retention.d7).toBe(0);
  });

  it("doesn't let activity before signup hide a return after it", () => {
    const { retention } = stats({
      users: [user("a", 10)],
      trips: [trip("a", 20), trip("a", 8)],
    });
    expect(retention.d7).toBe(100);
  });

  it("takes the first return, not a later one", () => {
    const { retention } = stats({
      users: [user("a", 40)],
      aiConversations: [
        { id: "late", user_id: "a", created_at: daysAgo(1) },
        { id: "early", user_id: "a", created_at: daysAgo(35) },
      ],
    });
    expect(retention.d7).toBe(100);
    expect(retention.d30).toBe(100);
  });

  it("compares with the signups one window earlier", () => {
    const { retention } = stats({
      users: [user("now", 10), user("before", 10), user("earlier", 10), user("old-1", 20), user("old-2", 20)],
      trips: [trip("now", 8), trip("old-1", 15)],
    });
    // Everyone is eligible: 2 of 5 back within 7 days. Of the three signed up 7 to 14
    // days ago, 1 is back.
    expect(retention.d7).toBe(40);
    expect(retention.d7Change).toBe(40 - 33);
  });

  it("is zero, not a division by nothing, with nobody to count", () => {
    expect(stats({}).retention).toMatchObject({ d1: 0, d7: 0, d30: 0, d7Change: 0 });
  });
});

describe("aha moments", () => {
  it("compares D7 retention of those who did it with those who didn't", () => {
    const { ahaMoments } = stats({
      users: [user("did", 20), user("didnt-back", 20), user("didnt-gone", 20)],
      trips: [trip("did", 18, true), trip("didnt-back", 15)],
    });
    expect(ahaMoments.sharedTrip).toEqual({ didIt: 100, didntDoIt: 50, retentionLift: 100 });
  });

  it("calls the lift 100 when nobody who skipped it came back", () => {
    const { ahaMoments } = stats({
      users: [user("did", 20), user("didnt", 20)],
      aiConversations: [{ id: "c", user_id: "did", created_at: daysAgo(18) }],
    });
    expect(ahaMoments.usedAssistant).toEqual({ didIt: 100, didntDoIt: 0, retentionLift: 100 });
  });

  it("reads each moment from its own table", () => {
    const signups = [user("a", 20), user("b", 20, { onboarding_completed: true })];
    const { ahaMoments } = stats({
      users: signups,
      aiConversations: [{ id: "c", user_id: "b", created_at: daysAgo(18) }],
      invites: [{ id: "i", trip_id: "t", created_by: "b", use_count: 0 }],
      collaborators: [{ id: "c", trip_id: "t", user_id: "b", role: "editor", invited_by: "a" }],
      proposalVotes: [{ id: "v", proposal_id: "p", user_id: "b", vote_type: "approve" }],
      proposals: [{ id: "p", proposed_by: "b", status: "pending", resolution_method: null }],
    });
    for (const moment of ["completedOnboarding", "createdInvite", "joinedViaInvite", "votedOnProposal", "createdProposal"] as const) {
      expect(ahaMoments[moment], moment).toEqual({ didIt: 100, didntDoIt: 0, retentionLift: 100 });
    }
  });

  it("leaves out the newest week's signups", () => {
    const { ahaMoments } = stats({ users: [user("new", 3)], trips: [trip("new", 1)] });
    expect(ahaMoments.generatedItinerary).toEqual({ didIt: 0, didntDoIt: 0, retentionLift: 0 });
  });
});

describe("the funnel and the lifecycle", () => {
  it("takes each step as a share of the signups", () => {
    const { funnel } = stats({
      users: [
        user("a", 10, { onboarding_completed: true }),
        user("b", 10, { subscription_tier: "pro" }),
        user("c", 10, { is_pro: true }),
        user("d", 10),
      ],
      trips: [trip("a", 5, true), trip("a", 4, true), trip(null, 4, true)],
    });
    expect(funnel).toEqual({
      acquisition: { count: 4, percentage: 100 },
      activation: { count: 1, percentage: 25 },
      retention: { count: 1, percentage: 25 },
      referral: { count: 1, percentage: 25 },
      revenue: { count: 2, percentage: 50 },
    });
  });

  it("doesn't count activity on the day of signup as having returned", () => {
    expect(stats({ users: [user("a", 5)], trips: [trip("a", 4.5)] }).funnel.retention.count).toBe(0);
  });

  it("places everyone by how many trips they own", () => {
    const owned = (id: string, n: number) => Array.from({ length: n }, () => trip(id));
    const { lifecycle } = stats({
      users: [user("none", 1), user("one", 1), user("two", 1), user("four", 1), user("five", 1)],
      trips: [...owned("one", 1), ...owned("two", 2), ...owned("four", 4), ...owned("five", 5), trip(null)],
    });
    expect(lifecycle).toEqual({ new: 1, activated: 1, engaged: 2, powerUser: 1 });
  });
});

describe("referrals", () => {
  it("rates sharing against the people who have a trip", () => {
    const { referral } = stats({
      users: [user("a", 5), user("b", 5), user("c", 5)],
      trips: [trip("a", 1, true), trip("a", 1, true), trip("b")],
    });
    expect(referral).toMatchObject({ totalTripShares: 2, usersWhoShared: 1, shareRate: 50, sharesPerUser: 1 });
  });

  it("measures reach by the anonymous voters, whatever opens a trip", () => {
    const { referral } = stats({
      anonVotes: [
        { id: "1", voter_cookie_id: "x", trip_id: "t1" },
        { id: "2", voter_cookie_id: "x", trip_id: "t2" },
        { id: "3", voter_cookie_id: "y", trip_id: "t2" },
        { id: "4", voter_cookie_id: null, trip_id: null },
      ],
    });
    expect(referral).toMatchObject({ anonymousEngagers: 2, totalShareViews: 2, sharedTripsWithEngagement: 2 });
  });

  it("converts referred signups against referral clicks, and works out K", () => {
    const { referral } = stats({
      users: [user("a", 5), user("b", 5, { referred_by_code: "X" })],
      trips: [trip("a", 1, true), trip("a", 1, true)],
      referralCodes: [{ id: "c", user_id: "a", total_clicks: 4, total_signups: 1 }],
    });
    expect(referral).toMatchObject({ totalReferralClicks: 4, referredSignups: 1, conversionRate: 25, sharesPerUser: 2, kFactor: 1 });
  });

  it("ranks the champions, a signup counting most and an invite twice a share", () => {
    const { referral } = stats({
      users: [user("sharer", 5), user("inviter", 5, { display_name: null }), user("referrer", 5)],
      trips: [trip("sharer", 1, true), trip("sharer", 1, true), trip("sharer", 1, true)],
      invites: [
        { id: "1", trip_id: "t", created_by: "inviter", use_count: 0 },
        { id: "2", trip_id: "t", created_by: "inviter", use_count: 0 },
        { id: "3", trip_id: "t", created_by: null, use_count: 0 },
      ],
      referralCodes: [
        { id: "c", user_id: "referrer", total_clicks: 0, total_signups: 1 },
        { id: "d", user_id: "gone", total_clicks: 0, total_signups: 0 },
      ],
    });
    expect(referral.topReferrers).toEqual([
      { name: "Name referrer", shares: 0, invites: 0, signups: 1 },
      { name: "inviter", shares: 0, invites: 2, signups: 0 },
      { name: "Name sharer", shares: 3, invites: 0, signups: 0 },
    ]);
  });

  it("keeps the top five", () => {
    const { referral } = stats({ trips: Array.from({ length: 8 }, (_, i) => trip(`u${i}`, 1, true)) });
    expect(referral.topReferrers).toHaveLength(5);
    expect(referral.topReferrers[0].name).toBe("Unknown");
  });
});

describe("collaboration", () => {
  const collaborator = (tripId: string, userId: string, role: string, invitedBy: string | null = null) => ({
    id: nextId("collab"),
    trip_id: tripId,
    user_id: userId,
    role,
    invited_by: invitedBy,
  });

  it("calls a trip collaborative with two or more on it", () => {
    const { collaboration } = stats({
      collaborators: [
        collaborator("t1", "a", "owner"),
        collaborator("t1", "b", "editor"),
        collaborator("t2", "a", "owner"),
        collaborator("t2", "b", "voter"),
        collaborator("t2", "c", "viewer"),
        collaborator("t3", "a", "owner"),
      ],
    });
    expect(collaboration).toMatchObject({
      collaborativeTrips: 2,
      avgCollaboratorsPerTrip: 2.5,
      totalCollaborators: 6,
      roleDistribution: { owner: 3, editor: 1, voter: 1, viewer: 1 },
    });
  });

  it("rates invites by how often they were used", () => {
    const { collaboration } = stats({
      invites: [
        { id: "1", trip_id: "t1", created_by: "a", use_count: 3 },
        { id: "2", trip_id: "t1", created_by: "a", use_count: null },
      ],
    });
    expect(collaboration).toMatchObject({ tripsWithInvites: 1, totalInvitesCreated: 2, inviteAcceptRate: 150 });
  });

  it("rates approvals among the proposals that were decided", () => {
    const proposal = (status: string, method: string | null = null) => ({ id: nextId("p"), proposed_by: "a", status, resolution_method: method });
    const { collaboration } = stats({
      trips: [trip("a")],
      proposals: [
        proposal("approved", "consensus"),
        proposal("approved", "owner_override"),
        proposal("approved", "auto_approve"),
        proposal("rejected", "timeout"),
        proposal("withdrawn", "withdrawn"),
        proposal("pending"),
        proposal("voting"),
        proposal("expired"),
      ],
    });
    expect(collaboration).toMatchObject({
      totalProposals: 8,
      proposersCount: 1,
      proposalApprovalRate: 75,
      proposalsByStatus: { pending: 1, voting: 1, approved: 3, rejected: 1, withdrawn: 1, expired: 1 },
      resolutionMethods: { consensus: 1, ownerOverride: 1, autoApprove: 1, timeout: 1, withdrawn: 1 },
      funnel: { tripsCreated: 1, invitesCreated: 0, invitesAccepted: 0, proposalsCreated: 8, proposalsResolved: 5 },
    });
  });

  it("measures voting against everyone on a trip but its owner", () => {
    const vote = (proposalId: string, userId: string, type: string) => ({ id: nextId("v"), proposal_id: proposalId, user_id: userId, vote_type: type });
    const { collaboration } = stats({
      collaborators: [collaborator("t", "o", "owner"), collaborator("t", "a", "editor"), collaborator("t", "b", "voter")],
      proposalVotes: [vote("p1", "a", "approve"), vote("p1", "b", "reject"), vote("p2", "a", "approve")],
    });
    expect(collaboration).toMatchObject({
      totalProposalVotes: 3,
      uniqueVoters: 2,
      avgVotesPerProposal: 1.5,
      voteDistribution: { approve: 2, reject: 1 },
      participationRate: 100,
    });
  });
});

describe("the bananas economy", () => {
  it("sums what was earned, spent and expired", () => {
    const { bananasEconomy } = stats({
      users: [user("a", 5, { banana_balance: 30 }), user("b", 5, { banana_balance: 10 }), user("c", 5, { banana_balance: null })],
      bananaTransactions: [banana("a", 50), banana("a", -10), banana("a", -10, 1, { transaction_type: "expiration" })],
    });
    expect(bananasEconomy.overview).toMatchObject({ totalInCirculation: 40, totalEarned: 50, totalSpent: 20, totalExpired: 10, avgPerUser: 20 });
    expect(bananasEconomy.expiration.utilizationRate).toBe(80);
    expect(bananasEconomy.redemptions.redemptionRate).toBe(40);
  });

  it("calls utilization whole with nothing earned yet", () => {
    expect(stats({}).bananasEconomy.expiration.utilizationRate).toBe(100);
  });

  it("compares this week's earning with last week's", () => {
    const { velocity } = stats({
      bananaTransactions: [banana("a", 30, 2), banana("a", 20, 10), banana("a", 99, 20), banana("a", -5, 2)],
    }).bananasEconomy.overview;
    expect(velocity).toEqual({ current7d: 30, previous7d: 20, changePercent: 50 });
    expect(stats({ bananaTransactions: [banana("a", 5, 1)] }).bananasEconomy.overview.velocity.changePercent).toBe(100);
    expect(stats({}).bananasEconomy.overview.velocity.changePercent).toBe(0);
  });

  it("spreads people over the tiers, a missing tier being the first", () => {
    const { tierDistribution } = stats({
      users: [user("a", 5, { referral_tier: 0 }), user("b", 5, { referral_tier: null }), user("c", 5, { referral_tier: 1 }), user("d", 5, { referral_tier: 3 })],
    }).bananasEconomy;
    expect(tierDistribution).toMatchObject({
      tier0: { count: 2, pct: 50 },
      tier1: { count: 1, pct: 25 },
      tier2: { count: 0, pct: 0 },
      tier3: { count: 1, pct: 25 },
    });
  });

  it("averages the days from signup to each tier, from its own date", () => {
    const { avgDaysToTier } = stats({
      users: [user("a", 30), user("b", 30)],
      referralTiers: [
        { id: "1", user_id: "a", tier_1_unlocked_at: daysAgo(28), tier_2_unlocked_at: daysAgo(10), tier_3_unlocked_at: null },
        { id: "2", user_id: "b", tier_1_unlocked_at: daysAgo(26), tier_2_unlocked_at: null, tier_3_unlocked_at: null },
        { id: "3", user_id: "gone", tier_1_unlocked_at: daysAgo(1), tier_2_unlocked_at: null, tier_3_unlocked_at: null },
      ],
    }).bananasEconomy.tierDistribution;
    expect(avgDaysToTier).toEqual({ tier1: 3, tier2: 20, tier3: null });
  });

  it("names the top earners as their leaderboard settings say", () => {
    const { byType, topEarners } = stats({
      users: [
        user("open", 5, { display_name: "Ana", referral_tier: 2 }),
        user("hidden", 5, { show_on_leaderboard: false }),
        user("initials", 5, { display_name: "Bo", leaderboard_visibility: "initials" }),
        user("nameless", 5, { display_name: null }),
      ],
      bananaTransactions: [
        banana("open", 40),
        banana("hidden", 30, 1, { transaction_type: "signup" }),
        banana("initials", 20),
        banana("nameless", 10),
        banana("gone", 999),
        banana("open", -5),
      ],
    }).bananasEconomy.earningBreakdown;
    expect(byType).toEqual({ referral: 1069, signup: 30 });
    expect(topEarners).toEqual([
      { displayName: "Ana", total: 40, tier: 2 },
      { displayName: "Anonymous", total: 30, tier: 0 },
      { displayName: "B***", total: 20, tier: 0 },
      { displayName: "Anonymous", total: 10, tier: 0 },
    ]);
  });

  it("names what was redeemed most, from the catalog", () => {
    const redeem = (userId: string, item: string, spent: number) => ({ id: nextId("r"), user_id: userId, catalog_item_id: item, bananas_spent: spent });
    const { redemptions } = stats({
      redemptionCatalog: [
        { id: "x", name: "Sticker" },
        { id: "y", name: "Upgrade" },
      ],
      bananaRedemptions: [redeem("a", "x", 5), redeem("a", "y", 50), redeem("b", "y", 50), redeem("b", "off-the-list", 1)],
    }).bananasEconomy;
    expect(redemptions).toMatchObject({ total: 4, uniqueRedeemers: 2 });
    expect(redemptions.topItems).toEqual([
      { name: "Upgrade", count: 2, spent: 100 },
      { name: "Sticker", count: 1, spent: 5 },
    ]);
  });

  it("flags what expires within a month, and nothing else", () => {
    const expiring = (days: number, extra: Record<string, unknown> = {}) => ({ expires_at: daysAgo(-days), ...extra });
    const { expiration } = stats({
      bananaTransactions: [
        banana("a", 10, 1, expiring(5)),
        banana("a", 20, 1, expiring(29)),
        banana("b", 40, 1, expiring(10)),
        banana("c", 80, 1, expiring(40)),
        banana("c", 160, 1, expiring(-1)),
        banana("c", 320, 1, expiring(5, { expired: true })),
        banana("c", -640, 1, expiring(5)),
        banana("c", 1280),
      ],
    }).bananasEconomy;
    expect(expiration).toMatchObject({ atRisk30d: 70, atRiskUsers: 2 });
  });
});

describe("what the tab is told about itself", () => {
  it("says retention is a proxy until sign-ins are tracked", () => {
    expect(stats({ users: [user("a", 5)] }).meta).toMatchObject({ retentionMethod: "activity_proxy", signInTrackingAvailable: false });
    expect(stats({ users: [user("a", 5, { last_sign_in_at: daysAgo(1) })] }).meta).toMatchObject({ retentionMethod: "sign_in", signInTrackingAvailable: true });
  });

  it("takes a sign-in as activity when it's there", () => {
    const { retention } = stats({ users: [user("a", 10, { last_sign_in_at: daysAgo(8) })] });
    expect(retention.d7).toBe(100);
  });

  it("says whether referral attribution works, passes on read failures, and dates itself", () => {
    expect(stats({ users: [user("a", 5)] }).meta.referralAttributionWired).toBe(false);
    expect(stats({ users: [user("a", 5, { referred_by_code: "X" })] }).meta.referralAttributionWired).toBe(true);
    const { meta } = stats({}, ["trips: read failed"]);
    expect(meta.dataWarnings).toEqual(["trips: read failed"]);
    expect(meta.generatedAt).toBe(NOW.toISOString());
  });
});
