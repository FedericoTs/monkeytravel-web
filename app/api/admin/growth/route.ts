import { getAuthenticatedAdmin } from "@/lib/api/auth";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";

// Growth metrics for Sean Ellis framework
export interface GrowthStats {
  retention: {
    d1: number;
    d7: number;
    d30: number;
    d1Change: number; // vs previous period
    d7Change: number;
    d30Change: number;
    sampleSizes: {
      d1Eligible: number;
      d7Eligible: number;
      d30Eligible: number;
    };
  };
  funnel: {
    acquisition: { count: number; percentage: number };
    activation: { count: number; percentage: number };
    retention: { count: number; percentage: number };
    referral: { count: number; percentage: number };
    revenue: { count: number; percentage: number };
  };
  lifecycle: {
    new: number;
    activated: number;
    engaged: number;
    powerUser: number;
  };
  referral: {
    // Share Actions (what users DO)
    totalTripShares: number;        // Trips with share_token enabled
    usersWhoShared: number;         // Unique users who shared at least 1 trip
    shareRate: number;              // % of users who have shared

    // Reach & Clicks
    totalShareViews: number;        // Views on shared trips
    totalReferralClicks: number;    // Clicks on referral links

    // Conversions
    referredSignups: number;        // Users who signed up via referral
    conversionRate: number;         // signups / clicks %

    // Viral Coefficient
    kFactor: number;                // (shares/users) × (signups/shares) - K>1 = viral
    sharesPerUser: number;          // Average shares per active user

    topReferrers: {
      name: string;
      shares: number;
      signups: number;
    }[];
  };
  ahaMoments: {
    generatedItinerary: { didIt: number; didntDoIt: number; retentionLift: number };
    sharedTrip: { didIt: number; didntDoIt: number; retentionLift: number };
    completedOnboarding: { didIt: number; didntDoIt: number; retentionLift: number };
    usedAssistant: { didIt: number; didntDoIt: number; retentionLift: number };
    // Collaboration aha moments
    createdInvite: { didIt: number; didntDoIt: number; retentionLift: number };
    joinedViaInvite: { didIt: number; didntDoIt: number; retentionLift: number };
    votedOnProposal: { didIt: number; didntDoIt: number; retentionLift: number };
    createdProposal: { didIt: number; didntDoIt: number; retentionLift: number };
  };
  // Collaboration metrics
  collaboration: {
    // Adoption metrics
    collaborativeTrips: number;       // Trips with 2+ collaborators
    tripsWithInvites: number;         // Trips with invite links created
    totalInvitesCreated: number;      // Total invite links
    inviteAcceptRate: number;         // % of invites used
    avgCollaboratorsPerTrip: number;  // Avg team size (for collaborative trips)
    totalCollaborators: number;       // Total collaborator records

    // Proposal metrics
    totalProposals: number;
    proposalsByStatus: {
      pending: number;
      voting: number;
      approved: number;
      rejected: number;
      withdrawn: number;
      expired: number;
    };
    proposalApprovalRate: number;     // % of resolved that were approved
    avgVotesPerProposal: number;
    proposersCount: number;           // Unique users who created proposals

    // Voting metrics
    totalProposalVotes: number;
    uniqueVoters: number;
    voteDistribution: { approve: number; reject: number };
    participationRate: number;        // voters / eligible collaborators

    // Resolution methods
    resolutionMethods: {
      consensus: number;
      ownerOverride: number;
      autoApprove: number;
      timeout: number;
      withdrawn: number;
    };

    // Role distribution
    roleDistribution: {
      owner: number;
      editor: number;
      voter: number;
      viewer: number;
    };

    // Collaboration funnel
    funnel: {
      tripsCreated: number;
      invitesCreated: number;
      invitesAccepted: number;
      proposalsCreated: number;
      proposalsResolved: number;
    };
  };
  // Bananas economy metrics
  bananasEconomy: {
    overview: {
      totalInCirculation: number;
      totalEarned: number;
      totalSpent: number;
      totalExpired: number;
      avgPerUser: number;
      velocity: { current7d: number; previous7d: number; changePercent: number };
    };
    tierDistribution: {
      tier0: { count: number; pct: number };
      tier1: { count: number; pct: number };
      tier2: { count: number; pct: number };
      tier3: { count: number; pct: number };
      avgDaysToTier: { tier1: number | null; tier2: number | null; tier3: number | null };
    };
    earningBreakdown: {
      byType: Record<string, number>;
      topEarners: { displayName: string; total: number; tier: number }[];
    };
    redemptions: {
      total: number;
      bananasSpent: number;
      uniqueRedeemers: number;
      redemptionRate: number;
      topItems: { name: string; count: number; spent: number }[];
    };
    expiration: {
      atRisk30d: number;
      atRiskUsers: number;
      totalExpired: number;
      utilizationRate: number;
    };
  };
}

export async function GET() {
  try {
    const { supabase, errorResponse } = await getAuthenticatedAdmin();
    if (errorResponse) return errorResponse;

    const now = new Date();
    const nowISO = now.toISOString();

    // Calculate date thresholds
    const d1Ago = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString();
    const d7Ago = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const d30Ago = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const d60Ago = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString();

    // Fetch all data in parallel
    const [
      usersResult,
      tripsResult,
      referralCodesResult,
      tripViewsResult,
      aiConversationsResult,
      // Collaboration data
      collaboratorsResult,
      invitesResult,
      proposalsResult,
      proposalVotesResult,
      // Bananas economy data
      bananaTransactionsResult,
      referralTiersResult,
      redemptionCatalogResult,
      bananaRedemptionsResult,
    ] = await Promise.all([
      // All users with relevant dates and bananas economy fields
      supabase
        .from("users")
        .select("id, display_name, created_at, last_sign_in_at, onboarding_completed, subscription_tier, is_pro, referred_by_code, banana_balance, referral_tier, show_on_leaderboard, leaderboard_visibility"),
      // All trips with user_id and share_token
      supabase
        .from("trips")
        .select("id, user_id, created_at, share_token, shared_at, is_template"),
      // Referral codes (for referral link tracking)
      supabase
        .from("referral_codes")
        .select("id, user_id, code, total_clicks, total_signups, total_conversions"),
      // Trip views (for share reach tracking)
      supabase
        .from("trip_views")
        .select("id, trip_id, viewer_id, viewed_at"),
      // AI conversations (for assistant usage)
      supabase
        .from("ai_conversations")
        .select("id, user_id"),
      // Collaboration: Trip collaborators
      supabase
        .from("trip_collaborators")
        .select("id, trip_id, user_id, role, invited_by, joined_at"),
      // Collaboration: Trip invites
      supabase
        .from("trip_invites")
        .select("id, trip_id, token, role, created_by, created_at, expires_at, max_uses, use_count, is_active"),
      // Collaboration: Activity proposals
      supabase
        .from("activity_proposals")
        .select("id, trip_id, proposed_by, type, status, resolved_at, resolved_by, resolution_method, created_at"),
      // Collaboration: Proposal votes
      supabase
        .from("proposal_votes")
        .select("id, proposal_id, user_id, vote_type, voted_at"),
      // Bananas economy: All transactions
      supabase
        .from("banana_transactions")
        .select("id, user_id, amount, transaction_type, created_at, expires_at, expired"),
      // Bananas economy: Referral tier unlock history
      supabase
        .from("referral_tiers")
        .select("id, user_id, tier, unlocked_at"),
      // Bananas economy: Redemption catalog
      supabase
        .from("banana_redemption_catalog")
        .select("id, name, cost, category, is_active"),
      // Bananas economy: User redemptions
      supabase
        .from("banana_redemptions")
        .select("id, user_id, catalog_item_id, bananas_spent, created_at"),
    ]);

    const users = usersResult.data || [];
    const trips = (tripsResult.data || []).filter(t => !t.is_template);
    const referralCodes = referralCodesResult.data || [];
    const tripViews = tripViewsResult.data || [];
    const aiConversations = aiConversationsResult.data || [];
    // Collaboration data extraction
    const collaborators = collaboratorsResult.data || [];
    const invites = invitesResult.data || [];
    const proposals = proposalsResult.data || [];
    const proposalVotes = proposalVotesResult.data || [];
    // Bananas economy data extraction
    const bananaTransactions = bananaTransactionsResult.data || [];
    const referralTiersData = referralTiersResult.data || [];
    const redemptionCatalog = redemptionCatalogResult.data || [];
    const bananaRedemptions = bananaRedemptionsResult.data || [];

    // Helper: calculate retention for users signed up before a threshold
    // FIXED: Changed from >= to > 0 AND <= to properly measure "returned WITHIN N days"
    // D1 = Users who returned within 1 day (came back at least once within 24 hours)
    // D7 = Users who returned within 7 days (came back at least once within 7 days)
    // D30 = Users who returned within 30 days (came back at least once within 30 days)
    const calculateRetention = (daysAgo: number, returnWithinDays: number) => {
      const threshold = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
      const eligibleUsers = users.filter(u => new Date(u.created_at) < threshold);

      if (eligibleUsers.length === 0) return { rate: 0, eligible: 0 };

      const returnedUsers = eligibleUsers.filter(u => {
        if (!u.last_sign_in_at) return false;
        const createdAt = new Date(u.created_at);
        const lastSignIn = new Date(u.last_sign_in_at);
        const daysSinceCreation = (lastSignIn.getTime() - createdAt.getTime()) / (24 * 60 * 60 * 1000);
        // User must have returned (daysSinceCreation > 0) within the retention window
        return daysSinceCreation > 0 && daysSinceCreation <= returnWithinDays;
      });

      return {
        rate: Math.round((returnedUsers.length / eligibleUsers.length) * 100),
        eligible: eligibleUsers.length,
      };
    };

    // Calculate retention metrics
    const d1Current = calculateRetention(1, 1);
    const d7Current = calculateRetention(7, 7);
    const d30Current = calculateRetention(30, 30);

    // Calculate previous period retention for comparison (shift by same period)
    const calculateRetentionPreviousPeriod = (daysAgo: number, returnWithinDays: number) => {
      const endThreshold = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
      const startThreshold = new Date(now.getTime() - (daysAgo * 2) * 24 * 60 * 60 * 1000);
      const eligibleUsers = users.filter(u => {
        const created = new Date(u.created_at);
        return created < endThreshold && created >= startThreshold;
      });

      if (eligibleUsers.length === 0) return 0;

      const returnedUsers = eligibleUsers.filter(u => {
        if (!u.last_sign_in_at) return false;
        const createdAt = new Date(u.created_at);
        const lastSignIn = new Date(u.last_sign_in_at);
        const daysSinceCreation = (lastSignIn.getTime() - createdAt.getTime()) / (24 * 60 * 60 * 1000);
        // FIXED: User must have returned (daysSinceCreation > 0) within the retention window
        return daysSinceCreation > 0 && daysSinceCreation <= returnWithinDays;
      });

      return Math.round((returnedUsers.length / eligibleUsers.length) * 100);
    };

    const d1Previous = calculateRetentionPreviousPeriod(1, 1);
    const d7Previous = calculateRetentionPreviousPeriod(7, 7);
    const d30Previous = calculateRetentionPreviousPeriod(30, 30);

    // AARRR Funnel calculations
    const totalUsers = users.length;
    const activatedUsers = users.filter(u => u.onboarding_completed).length;
    const usersWithTrips = new Set(trips.map(t => t.user_id)).size;
    const returnedUsers = users.filter(u => {
      if (!u.last_sign_in_at) return false;
      const createdAt = new Date(u.created_at);
      const lastSignIn = new Date(u.last_sign_in_at);
      return (lastSignIn.getTime() - createdAt.getTime()) > 24 * 60 * 60 * 1000; // returned after 1+ day
    }).length;
    // Referral in funnel = users who shared at least one trip (the ACTION, not result)
    const sharedTripsForFunnel = trips.filter(t => t.share_token != null);
    const referringUsers = new Set(sharedTripsForFunnel.map(t => t.user_id).filter(Boolean)).size;
    const revenueUsers = users.filter(u => u.subscription_tier !== "free" || u.is_pro).length;

    // User lifecycle stages
    const tripsByUser = new Map<string, number>();
    trips.forEach(t => {
      if (t.user_id) {
        tripsByUser.set(t.user_id, (tripsByUser.get(t.user_id) || 0) + 1);
      }
    });

    let newUsers = 0;
    let activatedLifecycle = 0;
    let engagedUsers = 0;
    let powerUsers = 0;

    users.forEach(u => {
      const tripCount = tripsByUser.get(u.id) || 0;
      if (tripCount === 0) {
        newUsers++;
      } else if (tripCount === 1) {
        activatedLifecycle++;
      } else if (tripCount < 5) {
        engagedUsers++;
      } else {
        powerUsers++;
      }
    });

    // ===========================================
    // REFERRAL METRICS (Sean Ellis Framework)
    // ===========================================

    // 1. SHARE ACTIONS - What users actually DO
    const sharedTrips = trips.filter(t => t.share_token != null);
    const totalTripShares = sharedTrips.length;
    const userIdsWhoShared = new Set(sharedTrips.map(t => t.user_id).filter(Boolean));
    const usersWhoShared = userIdsWhoShared.size;
    // FIX: Use usersWithTrips (defined above) as denominator (users without trips CAN'T share)
    const shareRate = usersWithTrips > 0 ? Math.round((usersWhoShared / usersWithTrips) * 100) : 0;

    // 2. REACH - How far shares travel
    const totalShareViews = tripViews.length;
    const totalReferralClicks = referralCodes.reduce((sum, c) => sum + (c.total_clicks || 0), 0);

    // 3. CONVERSIONS - Users who signed up via referral
    const referredSignups = users.filter(u => u.referred_by_code != null).length;
    // FIX: Use only referral clicks for conversion rate (not mixed with content share views)
    // Trip share views are content sharing, referral clicks are explicit invitations
    const conversionRate = totalReferralClicks > 0 ? Math.round((referredSignups / totalReferralClicks) * 100) : 0;

    // 4. K-FACTOR (Viral Coefficient)
    // K = (invites per user) × (conversion rate)
    // K > 1 means each user brings in more than 1 new user = viral growth
    // FIX: Use usersWithTrips as denominator and 4 decimal precision for K-factor analysis
    const sharesPerUser = usersWithTrips > 0 ? Math.round((totalTripShares / usersWithTrips) * 10000) / 10000 : 0;
    const referralConversionRate = totalTripShares > 0 ? referredSignups / totalTripShares : 0;
    const kFactor = Math.round(sharesPerUser * referralConversionRate * 10000) / 10000;

    // 5. TOP REFERRERS - Users who drive the most shares/signups
    // Group shares by user and combine with referral signups
    const userShareCounts = new Map<string, number>();
    sharedTrips.forEach(t => {
      if (t.user_id) {
        userShareCounts.set(t.user_id, (userShareCounts.get(t.user_id) || 0) + 1);
      }
    });

    const userSignupCounts = new Map<string, number>();
    referralCodes.forEach(c => {
      if (c.total_signups > 0) {
        userSignupCounts.set(c.user_id, c.total_signups);
      }
    });

    // Combine and rank top referrers
    const allSharerIds = new Set([...userShareCounts.keys(), ...userSignupCounts.keys()]);
    const topReferrers = Array.from(allSharerIds)
      .map(userId => {
        const user = users.find(u => u.id === userId);
        return {
          name: user?.display_name || user?.id?.slice(0, 8) || "Unknown",
          shares: userShareCounts.get(userId) || 0,
          signups: userSignupCounts.get(userId) || 0,
        };
      })
      .filter(r => r.shares > 0 || r.signups > 0)
      .sort((a, b) => (b.shares + b.signups * 10) - (a.shares + a.signups * 10)) // Weight signups more
      .slice(0, 5);

    // Aha Moment correlations
    // Users who created a trip vs didn't - and their D7 retention
    const usersWhoCreatedTrip = new Set(trips.map(t => t.user_id));
    const usersWhoSharedTrip = new Set(trips.filter(t => t.share_token).map(t => t.user_id));
    const usersWhoCompletedOnboarding = new Set(users.filter(u => u.onboarding_completed).map(u => u.id));
    const usersWhoUsedAssistant = new Set(aiConversations.map(c => c.user_id));

    // Collaboration aha moment user sets
    const usersWhoCreatedInvite = new Set(invites.map(i => i.created_by));
    const usersWhoJoinedViaInvite = new Set(collaborators.filter(c => c.invited_by).map(c => c.user_id));
    const usersWhoVotedOnProposal = new Set(proposalVotes.map(v => v.user_id));
    const usersWhoCreatedProposal = new Set(proposals.map(p => p.proposed_by));

    const calculateAhaMomentRetention = (userSet: Set<string | null>) => {
      // Filter out null values from the set
      const validUserIds = Array.from(userSet).filter((id): id is string => id !== null);

      // D7 eligible users (created more than 7 days ago)
      const d7Threshold = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const eligibleUsers = users.filter(u => new Date(u.created_at) < d7Threshold);

      if (eligibleUsers.length === 0) return { didIt: 0, didntDoIt: 0, retentionLift: 0 };

      const didItUsers = eligibleUsers.filter(u => validUserIds.includes(u.id));
      const didntDoItUsers = eligibleUsers.filter(u => !validUserIds.includes(u.id));

      const calculateD7Retention = (userList: typeof eligibleUsers) => {
        if (userList.length === 0) return 0;
        const returned = userList.filter(u => {
          if (!u.last_sign_in_at) return false;
          const createdAt = new Date(u.created_at);
          const lastSignIn = new Date(u.last_sign_in_at);
          // FIX: Measure "returned WITHIN 7 days" not "returned AFTER 7+ days"
          // User must have returned (diff > 0) AND within 7 days (diff <= 7 days)
          const daysSinceCreation = (lastSignIn.getTime() - createdAt.getTime()) / (24 * 60 * 60 * 1000);
          return daysSinceCreation > 0 && daysSinceCreation <= 7;
        });
        return Math.round((returned.length / userList.length) * 100);
      };

      const didItRetention = calculateD7Retention(didItUsers);
      const didntDoItRetention = calculateD7Retention(didntDoItUsers);
      const lift = didntDoItRetention > 0
        ? Math.round(((didItRetention - didntDoItRetention) / didntDoItRetention) * 100)
        : didItRetention > 0 ? 100 : 0;

      return {
        didIt: didItRetention,
        didntDoIt: didntDoItRetention,
        retentionLift: lift,
      };
    };

    // ===========================================
    // COLLABORATION METRICS
    // ===========================================

    // 1. ADOPTION METRICS
    // Count trips by their number of collaborators
    const collaboratorsByTrip = new Map<string, number>();
    collaborators.forEach(c => {
      collaboratorsByTrip.set(c.trip_id, (collaboratorsByTrip.get(c.trip_id) || 0) + 1);
    });

    // Trips with 2+ collaborators (truly collaborative)
    const collaborativeTrips = Array.from(collaboratorsByTrip.values()).filter(count => count >= 2).length;

    // Trips with invite links created
    const tripsWithInvites = new Set(invites.map(i => i.trip_id)).size;

    // Invite acceptance rate (use_count / total invites)
    const totalInvitesCreated = invites.length;
    const totalInviteUses = invites.reduce((sum, i) => sum + (i.use_count || 0), 0);
    const inviteAcceptRate = totalInvitesCreated > 0
      ? Math.round((totalInviteUses / totalInvitesCreated) * 100)
      : 0;

    // Average collaborators per collaborative trip
    const collaborativeTripSizes = Array.from(collaboratorsByTrip.values()).filter(count => count >= 2);
    const avgCollaboratorsPerTrip = collaborativeTripSizes.length > 0
      ? Math.round((collaborativeTripSizes.reduce((a, b) => a + b, 0) / collaborativeTripSizes.length) * 10) / 10
      : 0;

    // 2. PROPOSAL METRICS
    const totalProposals = proposals.length;

    // Count proposals by status
    const proposalsByStatus = {
      pending: proposals.filter(p => p.status === "pending").length,
      voting: proposals.filter(p => p.status === "voting").length,
      approved: proposals.filter(p => p.status === "approved").length,
      rejected: proposals.filter(p => p.status === "rejected").length,
      withdrawn: proposals.filter(p => p.status === "withdrawn").length,
      expired: proposals.filter(p => p.status === "expired").length,
    };

    // Approval rate (of resolved proposals)
    const resolvedProposals = proposalsByStatus.approved + proposalsByStatus.rejected;
    const proposalApprovalRate = resolvedProposals > 0
      ? Math.round((proposalsByStatus.approved / resolvedProposals) * 100)
      : 0;

    // Average votes per proposal (for proposals with votes)
    const proposalsWithVotes = new Set(proposalVotes.map(v => v.proposal_id)).size;
    const avgVotesPerProposal = proposalsWithVotes > 0
      ? Math.round((proposalVotes.length / proposalsWithVotes) * 10) / 10
      : 0;

    // Unique proposers
    const proposersCount = new Set(proposals.map(p => p.proposed_by)).size;

    // 3. VOTING METRICS
    const totalProposalVotes = proposalVotes.length;
    const uniqueVoters = new Set(proposalVotes.map(v => v.user_id)).size;

    // Vote distribution
    const voteDistribution = {
      approve: proposalVotes.filter(v => v.vote_type === "approve").length,
      reject: proposalVotes.filter(v => v.vote_type === "reject").length,
    };

    // Participation rate: voters / total collaborators (excluding owners)
    const nonOwnerCollaborators = collaborators.filter(c => c.role !== "owner").length;
    const participationRate = nonOwnerCollaborators > 0
      ? Math.round((uniqueVoters / nonOwnerCollaborators) * 100)
      : 0;

    // 4. RESOLUTION METHODS
    const resolutionMethods = {
      consensus: proposals.filter(p => p.resolution_method === "consensus").length,
      ownerOverride: proposals.filter(p => p.resolution_method === "owner_override").length,
      autoApprove: proposals.filter(p => p.resolution_method === "auto_approve").length,
      timeout: proposals.filter(p => p.resolution_method === "timeout").length,
      withdrawn: proposals.filter(p => p.resolution_method === "withdrawn").length,
    };

    // 5. ROLE DISTRIBUTION
    const roleDistribution = {
      owner: collaborators.filter(c => c.role === "owner").length,
      editor: collaborators.filter(c => c.role === "editor").length,
      voter: collaborators.filter(c => c.role === "voter").length,
      viewer: collaborators.filter(c => c.role === "viewer").length,
    };

    // 6. COLLABORATION FUNNEL
    const collaborationFunnel = {
      tripsCreated: trips.length,
      invitesCreated: totalInvitesCreated,
      invitesAccepted: totalInviteUses,
      proposalsCreated: totalProposals,
      proposalsResolved: proposalsByStatus.approved + proposalsByStatus.rejected + proposalsByStatus.withdrawn,
    };

    // ===========================================
    // 7. BANANAS ECONOMY METRICS
    // ===========================================

    // Economy Overview
    const totalInCirculation = users.reduce((s, u) => s + (u.banana_balance || 0), 0);
    const usersWithBananas = users.filter(u => (u.banana_balance || 0) > 0).length;
    const totalEarned = bananaTransactions
      .filter(t => t.amount > 0)
      .reduce((s, t) => s + t.amount, 0);
    const totalSpent = bananaTransactions
      .filter(t => t.amount < 0)
      .reduce((s, t) => s + Math.abs(t.amount), 0);
    const totalExpiredBananas = bananaTransactions
      .filter(t => t.transaction_type === "expiration")
      .reduce((s, t) => s + Math.abs(t.amount), 0);

    // Velocity (7d vs previous 7d)
    const d7AgoDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const d14AgoDate = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const current7dEarned = bananaTransactions
      .filter(t => t.amount > 0 && new Date(t.created_at) >= d7AgoDate)
      .reduce((s, t) => s + t.amount, 0);
    const previous7dEarned = bananaTransactions
      .filter(t => t.amount > 0 && new Date(t.created_at) >= d14AgoDate && new Date(t.created_at) < d7AgoDate)
      .reduce((s, t) => s + t.amount, 0);
    const velocityChange = previous7dEarned > 0
      ? Math.round(((current7dEarned - previous7dEarned) / previous7dEarned) * 100)
      : (current7dEarned > 0 ? 100 : 0);

    // Tier distribution from users table
    const tierCounts = { 0: 0, 1: 0, 2: 0, 3: 0 };
    users.forEach(u => {
      const tier = (u.referral_tier || 0) as 0 | 1 | 2 | 3;
      tierCounts[tier]++;
    });
    const totalUsersForTier = users.length;

    // Earning by type
    const earningByType: Record<string, number> = {};
    bananaTransactions.filter(t => t.amount > 0).forEach(t => {
      earningByType[t.transaction_type] = (earningByType[t.transaction_type] || 0) + t.amount;
    });

    // Top earners (anonymized per leaderboard settings)
    const userEarnings = new Map<string, { total: number; user: typeof users[0] }>();
    bananaTransactions.filter(t => t.amount > 0).forEach(t => {
      const existing = userEarnings.get(t.user_id);
      const user = users.find(u => u.id === t.user_id);
      if (user) {
        userEarnings.set(t.user_id, { total: (existing?.total || 0) + t.amount, user });
      }
    });
    const topEarners = [...userEarnings.values()]
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)
      .map(e => ({
        displayName: e.user.show_on_leaderboard === false ? "Anonymous" :
          e.user.leaderboard_visibility === "initials" ? `${e.user.display_name?.[0] || "U"}***` :
          e.user.display_name || "Anonymous",
        total: e.total,
        tier: e.user.referral_tier || 0,
      }));

    // Redemptions
    const redemptionRate = totalEarned > 0
      ? Math.round((totalSpent / totalEarned) * 1000) / 10
      : 0;
    const uniqueRedeemers = new Set(bananaRedemptions.map(r => r.user_id)).size;
    const itemCounts = new Map<string, { name: string; count: number; spent: number }>();
    bananaRedemptions.forEach(r => {
      const item = redemptionCatalog.find(c => c.id === r.catalog_item_id);
      if (item) {
        const existing = itemCounts.get(item.id) || { name: item.name, count: 0, spent: 0 };
        itemCounts.set(item.id, { ...existing, count: existing.count + 1, spent: existing.spent + r.bananas_spent });
      }
    });
    const topItems = [...itemCounts.values()].sort((a, b) => b.count - a.count).slice(0, 5);

    // Expiration metrics
    const d30FromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const atRiskTransactions = bananaTransactions.filter(t =>
      t.amount > 0 && !t.expired && t.expires_at &&
      new Date(t.expires_at) > now && new Date(t.expires_at) <= d30FromNow
    );
    const atRisk30d = atRiskTransactions.reduce((s, t) => s + t.amount, 0);
    const atRiskUsers = new Set(atRiskTransactions.map(t => t.user_id)).size;
    const utilizationRate = totalEarned > 0
      ? Math.round(((totalEarned - totalExpiredBananas) / totalEarned) * 1000) / 10
      : 100;

    // Avg days to tier (from referral_tiers table)
    const avgDaysToTier: { tier1: number | null; tier2: number | null; tier3: number | null } = {
      tier1: null,
      tier2: null,
      tier3: null,
    };
    // Calculate avg days for each tier based on unlock timestamps
    [1, 2, 3].forEach(tier => {
      const tierUnlocks = referralTiersData.filter(rt => rt.tier === tier);
      if (tierUnlocks.length > 0) {
        // Find account creation for each user who unlocked this tier
        const daysToUnlock = tierUnlocks.map(tu => {
          const user = users.find(u => u.id === tu.user_id);
          if (user) {
            const createdAt = new Date(user.created_at);
            const unlockedAt = new Date(tu.unlocked_at);
            return Math.round((unlockedAt.getTime() - createdAt.getTime()) / (24 * 60 * 60 * 1000));
          }
          return null;
        }).filter((d): d is number => d !== null);
        if (daysToUnlock.length > 0) {
          const tierKey = `tier${tier}` as "tier1" | "tier2" | "tier3";
          avgDaysToTier[tierKey] = Math.round(daysToUnlock.reduce((a, b) => a + b, 0) / daysToUnlock.length);
        }
      }
    });

    const growthStats: GrowthStats = {
      retention: {
        d1: d1Current.rate,
        d7: d7Current.rate,
        d30: d30Current.rate,
        d1Change: d1Current.rate - d1Previous,
        d7Change: d7Current.rate - d7Previous,
        d30Change: d30Current.rate - d30Previous,
        sampleSizes: {
          d1Eligible: d1Current.eligible,
          d7Eligible: d7Current.eligible,
          d30Eligible: d30Current.eligible,
        },
      },
      funnel: {
        acquisition: { count: totalUsers, percentage: 100 },
        activation: {
          count: activatedUsers,
          percentage: totalUsers > 0 ? Math.round((activatedUsers / totalUsers) * 100) : 0
        },
        retention: {
          count: returnedUsers,
          percentage: totalUsers > 0 ? Math.round((returnedUsers / totalUsers) * 100) : 0
        },
        referral: {
          count: referringUsers,
          percentage: totalUsers > 0 ? Math.round((referringUsers / totalUsers) * 100) : 0
        },
        revenue: {
          count: revenueUsers,
          percentage: totalUsers > 0 ? Math.round((revenueUsers / totalUsers) * 100) : 0
        },
      },
      lifecycle: {
        new: newUsers,
        activated: activatedLifecycle,
        engaged: engagedUsers,
        powerUser: powerUsers,
      },
      referral: {
        // Share Actions
        totalTripShares,
        usersWhoShared,
        shareRate,

        // Reach
        totalShareViews,
        totalReferralClicks,

        // Conversions
        referredSignups,
        conversionRate,

        // Viral Coefficient
        kFactor,
        sharesPerUser,

        topReferrers,
      },
      ahaMoments: {
        generatedItinerary: calculateAhaMomentRetention(usersWhoCreatedTrip),
        sharedTrip: calculateAhaMomentRetention(usersWhoSharedTrip),
        completedOnboarding: calculateAhaMomentRetention(usersWhoCompletedOnboarding),
        usedAssistant: calculateAhaMomentRetention(usersWhoUsedAssistant),
        // Collaboration aha moments
        createdInvite: calculateAhaMomentRetention(usersWhoCreatedInvite),
        joinedViaInvite: calculateAhaMomentRetention(usersWhoJoinedViaInvite),
        votedOnProposal: calculateAhaMomentRetention(usersWhoVotedOnProposal),
        createdProposal: calculateAhaMomentRetention(usersWhoCreatedProposal),
      },
      collaboration: {
        // Adoption metrics
        collaborativeTrips,
        tripsWithInvites,
        totalInvitesCreated,
        inviteAcceptRate,
        avgCollaboratorsPerTrip,
        totalCollaborators: collaborators.length,

        // Proposal metrics
        totalProposals,
        proposalsByStatus,
        proposalApprovalRate,
        avgVotesPerProposal,
        proposersCount,

        // Voting metrics
        totalProposalVotes,
        uniqueVoters,
        voteDistribution,
        participationRate,

        // Resolution methods
        resolutionMethods,

        // Role distribution
        roleDistribution,

        // Collaboration funnel
        funnel: collaborationFunnel,
      },
      bananasEconomy: {
        overview: {
          totalInCirculation,
          totalEarned,
          totalSpent,
          totalExpired: totalExpiredBananas,
          avgPerUser: usersWithBananas > 0 ? Math.round(totalInCirculation / usersWithBananas) : 0,
          velocity: {
            current7d: current7dEarned,
            previous7d: previous7dEarned,
            changePercent: velocityChange,
          },
        },
        tierDistribution: {
          tier0: { count: tierCounts[0], pct: totalUsersForTier > 0 ? Math.round((tierCounts[0] / totalUsersForTier) * 100) : 0 },
          tier1: { count: tierCounts[1], pct: totalUsersForTier > 0 ? Math.round((tierCounts[1] / totalUsersForTier) * 100) : 0 },
          tier2: { count: tierCounts[2], pct: totalUsersForTier > 0 ? Math.round((tierCounts[2] / totalUsersForTier) * 100) : 0 },
          tier3: { count: tierCounts[3], pct: totalUsersForTier > 0 ? Math.round((tierCounts[3] / totalUsersForTier) * 100) : 0 },
          avgDaysToTier,
        },
        earningBreakdown: {
          byType: earningByType,
          topEarners,
        },
        redemptions: {
          total: bananaRedemptions.length,
          bananasSpent: totalSpent,
          uniqueRedeemers,
          redemptionRate,
          topItems,
        },
        expiration: {
          atRisk30d,
          atRiskUsers,
          totalExpired: totalExpiredBananas,
          utilizationRate,
        },
      },
    };

    return apiSuccess(growthStats);
  } catch (error) {
    console.error("[Admin Growth] Error:", error);
    return errors.internal("Failed to fetch growth stats", "Admin Growth");
  }
}
