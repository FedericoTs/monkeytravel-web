import type { AdminStats } from "@/lib/admin/stats/types";

/** A full answer from /api/admin/stats, for rendering the Analytics tab. */
export const adminStatsFixture: AdminStats = {
  users: { total: 881, newLast7Days: 40, newLast30Days: 170, activeLast30Days: 210, withTrips: 500, withoutTrips: 381, deltaPctWoW: 12 },
  activation: { signupToFirstTripPct: 56.8, multiTripUsers: 120, multiTripPct: 24, sharedTripPct: 18.5, atRiskUsers: 77 },
  activationFunnel: null as unknown as AdminStats["activationFunnel"],
  churn: {
    neverCreatedTrip: 381,
    inactiveLast30Days: 671,
    retentionRate: 23.8,
    cohortRetention: [
      { cohort: "Oct 5", cohortSize: 44, retention: [100, 41, 22, 9] },
      { cohort: "Oct 12", cohortSize: 0, retention: [] },
    ],
  },
  trips: { total: 919, byStatus: { planning: 800, completed: 100, cancelled: 19 }, last7Days: 45, last30Days: 200, averagePerUser: 1, sharedTrips: 170, deltaPctWoW: -4 },
  ai: {
    totalRequests: 726,
    last7Days: 30,
    last30Days: 120,
    byAction: { assistant: 500, regenerate: 226 },
    byModel: { "gemini-2.5-flash": 700, "gemini-2.5-pro": 26 },
    totalTokens: { input: 1_200_000, output: 300_000 },
    totalCostCents: 500,
    conversationCount: 375,
    generationCosts: { totalUsd: 56.15, tripGenerations: 3994, activityRegenerations: 46 },
    totalCostUsd: 61.15,
    deltaPctWoW: 0,
    costPerTripUsd: 0.0665,
  },
  subscribers: { total: 29, last7Days: 1, last30Days: 4, verified: 20, unsubscribed: 2 },
  geo: {
    totalPageViews: 186_317,
    last7Days: 16_000,
    last30Days: 79_287,
    byCountry: [
      { country: "Italy", countryCode: "IT", count: 40_000, percentage: 21.5 },
      { country: "Brazil", countryCode: "BR", count: 20_000, percentage: 10.7 },
    ],
    byCity: [{ city: "Rome", country: "Italy", count: 9_000 }],
    topPages: [{ path: "/trips/new", count: 30_000 }],
    uniqueVisitors: 60_000,
    deltaPctWoW: 8,
    degraded: [],
    traffic: { daily: [], bySection: [], conversionFunnel: [] },
  },
  acquisition: {
    channels: [{ channel: "google", entrySessions: 500, reachedWizard: 100, wizardPct: 20, sharePct: 60 }],
    windowDays: 28,
  },
  engagement: {
    dau: 40,
    wau: 180,
    mau: 600,
    stickinessPct: 6.7,
    timeToFirstTrip: { avgHours: 30.5, medianHours: 0.4, usersCount: 500, within1h: 380, within24h: 430, within7d: 470 },
  },
  topDestinations: [
    { destination: "Lisbon", count: 40 },
    { destination: "Rome", count: 25 },
  ],
  recentActivity: [
    { type: "user", description: "New signup", timestamp: "2026-11-05T11:58:00.000Z" },
    { type: "trip", description: "Trip to Lisbon", timestamp: "2026-11-05T10:00:00.000Z" },
    { type: "ai", description: "assistant_message", timestamp: "2026-11-04T12:00:00.000Z" },
    { type: "subscriber", description: "New subscriber", timestamp: "2026-10-20T12:00:00.000Z" },
  ],
  userTrend: {
    daily: [{ date: "2026-11-05", count: 6, cumulative: 881 }],
    summary: { totalGrowth: 10, avgDaily: 5.7, bestDay: { date: "2026-11-01", count: 12 }, currentStreak: 4 },
  },
};
