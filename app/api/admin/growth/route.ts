import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";

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
  };
}

export async function GET() {
  try {
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check admin access
    if (!isAdmin(user.email)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

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
    ] = await Promise.all([
      // All users with relevant dates
      supabase
        .from("users")
        .select("id, display_name, created_at, last_sign_in_at, onboarding_completed, subscription_tier, is_pro, referred_by_code"),
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
    ]);

    const users = usersResult.data || [];
    const trips = (tripsResult.data || []).filter(t => !t.is_template);
    const referralCodes = referralCodesResult.data || [];
    const tripViews = tripViewsResult.data || [];
    const aiConversations = aiConversationsResult.data || [];

    // Helper: calculate retention for users signed up before a threshold
    const calculateRetention = (daysAgo: number, returnWithinDays: number) => {
      const threshold = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
      const eligibleUsers = users.filter(u => new Date(u.created_at) < threshold);

      if (eligibleUsers.length === 0) return { rate: 0, eligible: 0 };

      const returnedUsers = eligibleUsers.filter(u => {
        if (!u.last_sign_in_at) return false;
        const createdAt = new Date(u.created_at);
        const lastSignIn = new Date(u.last_sign_in_at);
        const daysSinceCreation = (lastSignIn.getTime() - createdAt.getTime()) / (24 * 60 * 60 * 1000);
        return daysSinceCreation >= returnWithinDays;
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
        return daysSinceCreation >= returnWithinDays;
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
    const shareRate = totalUsers > 0 ? Math.round((usersWhoShared / totalUsers) * 100) : 0;

    // 2. REACH - How far shares travel
    const totalShareViews = tripViews.length;
    const totalReferralClicks = referralCodes.reduce((sum, c) => sum + (c.total_clicks || 0), 0);

    // 3. CONVERSIONS - Users who signed up via referral
    const referredSignups = users.filter(u => u.referred_by_code != null).length;
    const totalClicks = totalReferralClicks + totalShareViews; // Combined reach
    const conversionRate = totalClicks > 0 ? Math.round((referredSignups / totalClicks) * 100) : 0;

    // 4. K-FACTOR (Viral Coefficient)
    // K = (invites per user) × (conversion rate)
    // K > 1 means each user brings in more than 1 new user = viral growth
    const sharesPerUser = totalUsers > 0 ? Math.round((totalTripShares / totalUsers) * 100) / 100 : 0;
    const referralConversionRate = totalTripShares > 0 ? referredSignups / totalTripShares : 0;
    const kFactor = Math.round(sharesPerUser * referralConversionRate * 100) / 100;

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
          return (lastSignIn.getTime() - createdAt.getTime()) >= 7 * 24 * 60 * 60 * 1000;
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
      },
    };

    return NextResponse.json(growthStats);
  } catch (error) {
    console.error("Growth stats error:", error);
    return NextResponse.json(
      { error: "Failed to fetch growth stats" },
      { status: 500 }
    );
  }
}
