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
    totalShareViews: number;        // Reach proxy: distinct anonymous engagers on shared trips
    anonymousEngagers: number;      // distinct anon voters on shared trips
    sharedTripsWithEngagement: number; // shared trips that got anonymous engagement
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
      invites: number;
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
  // Honesty / data-quality metadata so the UI labels metrics correctly.
  meta: {
    retentionMethod: "activity_proxy" | "sign_in";
    signInTrackingAvailable: boolean;
    referralAttributionWired: boolean;
    dataWarnings: string[];
    generatedAt: string;
  };
}
