import { type ActivationFunnelStats } from "@/lib/admin/activation-funnel";

// Cohort retention data for matrix visualization
export interface CohortData {
  cohort: string; // Week label (e.g., "Nov 25" or "Week 48")
  cohortSize: number; // Users who signed up in this cohort
  retention: number[]; // Retention % for Week 0, Week 1, etc.
}

export interface AdminStats {
  // User Metrics
  users: {
    total: number;
    newLast7Days: number;
    newLast30Days: number;
    activeLast30Days: number;
    withTrips: number;
    withoutTrips: number;
    // Week-over-week delta: signups in the most-recent 7 days vs the 7
    // days before that. Used by the headline KPI card to show direction.
    deltaPctWoW: number;
  };
  // Activation funnel — replaces the old "Churn Analysis" card.
  // Computes the real story: who actually got value from the product?
  activation: {
    signupToFirstTripPct: number;   // % of signups who created any trip
    multiTripUsers: number;          // users with 2+ trips
    multiTripPct: number;            // % of trip-creators with 2+ trips
    sharedTripPct: number;           // % of trips that have a share_token
    atRiskUsers: number;             // signed up but no trip + signed in >7d ago
  };
  // Consent-free cohort funnel by signup provider, plus the
  // signed-out share loop. Definitions in lib/admin/activation-funnel.ts.
  activationFunnel: ActivationFunnelStats;
  // Churn Metrics
  churn: {
    neverCreatedTrip: number;
    inactiveLast30Days: number;
    retentionRate: number;
    cohortRetention: CohortData[]; // Weekly cohort retention matrix
  };
  // Trip Metrics
  trips: {
    total: number;
    byStatus: Record<string, number>;
    last7Days: number;
    last30Days: number;
    averagePerUser: number;
    sharedTrips: number;
    deltaPctWoW: number;  // last 7 days vs the 7 before
  };
  // AI Usage Metrics
  ai: {
    totalRequests: number;
    last7Days: number;
    last30Days: number;
    byAction: Record<string, number>;
    byModel: Record<string, number>;
    totalTokens: { input: number; output: number };
    totalCostCents: number;
    conversationCount: number;
    // Generation costs (from api_request_logs)
    generationCosts: {
      totalUsd: number;
      tripGenerations: number;
      activityRegenerations: number;
    };
    // Combined total cost in USD (assistant + generation)
    totalCostUsd: number;
    deltaPctWoW: number;       // request count delta, last 7d vs prior 7d
    costPerTripUsd: number;    // total AI cost ÷ total trips
  };
  // Email Subscribers
  subscribers: {
    total: number;
    last7Days: number;
    last30Days: number;
    verified: number;
    unsubscribed: number;
  };
  // Geo/Analytics - Page Views by Country
  geo: {
    totalPageViews: number;
    last7Days: number;
    last30Days: number;
    byCountry: { country: string; countryCode: string; count: number; percentage: number }[];
    byCity: { city: string; country: string; count: number }[];
    topPages: { path: string; count: number }[];
    uniqueVisitors: number;
    deltaPctWoW: number;       // page-view delta, last 7d vs prior 7d
    /**
     * Metrics whose query FAILED for this response. Non-empty means the zeros
     * on screen are missing data, not an absence of traffic — the distinction
     * that was impossible to make while every result was read as
     * `(x.data || [])`.
     */
    degraded: string[];
    traffic: {
      daily: {
        date: string;
        views: number;
        uniqueVisitors: number;
        /**
         * Sessions that kept a page visible past the engagement threshold.
         * OPTIONAL on purpose: session_engagement is forward-only (no rows for
         * days before the beacon existed), so those days have no value and MUST
         * render as absent. A 0 here would draw a collapse that never happened.
         */
        engagedSessions?: number;
      }[];
      bySection: { section: string; count: number }[];
      conversionFunnel: { step: string; count: number }[];
    };
  };
  // Acquisition - entry channel per SESSION, from our own page views: first-party,
  // cookieless and aggregate, so it does not depend on consent as GA4 does.
  acquisition: {
    channels: {
      channel: string;
      entrySessions: number;
      reachedWizard: number;
      wizardPct: number;
      sharePct: number;
    }[];
    windowDays: number;
  };
  // Engagement Metrics
  engagement: {
    dau: number;
    wau: number;
    mau: number;
    stickinessPct: number;
    timeToFirstTrip: {
      avgHours: number;
      medianHours: number;
      usersCount: number;
      within1h: number;
      within24h: number;
      within7d: number;
    };
  };
  // Top Destinations
  topDestinations: { destination: string; count: number }[];
  // Recent Activity Timeline
  recentActivity: {
    type: "user" | "trip" | "ai" | "subscriber";
    description: string;
    timestamp: string;
  }[];
  // User Growth Trend (daily registrations)
  userTrend: {
    daily: { date: string; count: number; cumulative: number }[];
    summary: {
      totalGrowth: number; // % growth over selected period
      avgDaily: number;
      bestDay: { date: string; count: number } | null;
      currentStreak: number; // consecutive days with signups
    };
  };
}
