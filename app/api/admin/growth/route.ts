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
    codesGenerated: number;
    totalClicks: number;
    totalSignups: number;
    totalConversions: number;
    kFactor: number;
    topReferrers: { userId: string; code: string; signups: number }[];
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
      referralEventsResult,
      aiConversationsResult,
    ] = await Promise.all([
      // All users with relevant dates
      supabase
        .from("users")
        .select("id, created_at, last_sign_in_at, onboarding_completed, subscription_tier, is_pro, referred_by_code"),
      // All trips with user_id and share_token
      supabase
        .from("trips")
        .select("id, user_id, created_at, share_token, is_template"),
      // Referral codes
      supabase
        .from("referral_codes")
        .select("id, user_id, code, total_clicks, total_signups, total_conversions"),
      // Referral events
      supabase
        .from("referral_events")
        .select("id, event_type, event_at"),
      // AI conversations (for assistant usage)
      supabase
        .from("ai_conversations")
        .select("id, user_id"),
    ]);

    const users = usersResult.data || [];
    const trips = (tripsResult.data || []).filter(t => !t.is_template);
    const referralCodes = referralCodesResult.data || [];
    const referralEvents = referralEventsResult.data || [];
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
    const referringUsers = referralCodes.filter(c => c.total_signups > 0).length;
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

    // Referral metrics
    const totalClicks = referralCodes.reduce((sum, c) => sum + (c.total_clicks || 0), 0);
    const totalSignups = referralCodes.reduce((sum, c) => sum + (c.total_signups || 0), 0);
    const totalConversions = referralCodes.reduce((sum, c) => sum + (c.total_conversions || 0), 0);
    const kFactor = totalUsers > 0 ? totalSignups / totalUsers : 0;

    // Top referrers
    const topReferrers = referralCodes
      .filter(c => c.total_signups > 0)
      .sort((a, b) => (b.total_signups || 0) - (a.total_signups || 0))
      .slice(0, 5)
      .map(c => ({
        userId: c.user_id,
        code: c.code,
        signups: c.total_signups || 0,
      }));

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
        codesGenerated: referralCodes.length,
        totalClicks,
        totalSignups,
        totalConversions,
        kFactor: Math.round(kFactor * 100) / 100,
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
