import { createClient } from "@/lib/supabase/server";
import { logReadError } from "@/lib/supabase/log-read-error";
import { isNoRow } from "@/lib/supabase/no-row";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import ProfileClient from "./ProfileClient";

// Locale-aware <title>.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "common.navigation" });
  return {
    // Strip brand suffix — root layout's title.template adds it.
    title: t("profile"),
  };
}

export default async function ProfilePage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login?redirect=/profile");
  }

  // Profile, trips and beta access are independent - each needs only user.id -
  // so they run concurrently instead of stacked: three round trips in a row
  // were three network hops of waiting where one will do.
  const [profileResult, tripsResult, betaAccessResult] = await Promise.all([
    supabase
      .from("users")
      .select(`
        id,
        email,
        display_name,
        avatar_url,
        bio,
        home_country,
        home_city,
        date_of_birth,
        languages,
        preferences,
        notification_settings,
        privacy_settings,
        stats,
        created_at,
        last_sign_in_at
      `)
      .eq("id", user.id)
      .single(),
    supabase
      .from("trips")
      .select("id, start_date, end_date, status, itinerary")
      .eq("user_id", user.id)
      .or("is_archived.is.null,is_archived.eq.false"),
    // redeemed_at, not created_at: the table has no created_at, so this select
    // failed with 42703 on every profile load and the beta section never
    // showed. maybeSingle because most accounts have no row, which .single()
    // reports as a 406 error rather than null.
    supabase
      .from("user_tester_access")
      .select("code_used, redeemed_at, expires_at, ai_generations_limit, ai_regenerations_limit, ai_assistant_limit")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  // The settings form saves whole objects, so defaults shown for a refused
  // read would be saved over the stored settings.
  if (profileResult.error && !isNoRow(profileResult.error)) throw profileResult.error;
  const { data: profile } = profileResult;
  const { data: trips } = logReadError("profile: trips", tripsResult);
  const { data: betaAccess } = logReadError("profile: beta access", betaAccessResult);

  // Calculate stats
  const tripStats = {
    totalTrips: trips?.length || 0,
    countriesVisited: new Set(
      trips?.flatMap((t) => {
        // Extract destinations from itinerary if available
        const itinerary = t.itinerary as Array<{ activities?: Array<{ location?: string }> }> | null;
        if (!itinerary) return [];
        return itinerary.flatMap((day) =>
          day.activities?.map((a) => a.location).filter(Boolean) || []
        );
      }) || []
    ).size || 0,
    totalTravelDays: trips?.reduce((acc, trip) => {
      if (trip.start_date && trip.end_date) {
        const start = new Date(trip.start_date);
        const end = new Date(trip.end_date);
        return acc + Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      }
      return acc;
    }, 0) || 0,
    upcomingTrips: trips?.filter((t) => new Date(t.start_date) > new Date()).length || 0,
  };

  // Merge defaults with actual data
  const userProfile = {
    id: user.id,
    email: user.email || "",
    display_name: profile?.display_name || user.email?.split("@")[0] || "Traveler",
    avatar_url: profile?.avatar_url || null,
    bio: profile?.bio || "",
    home_country: profile?.home_country || "",
    home_city: profile?.home_city || "",
    date_of_birth: profile?.date_of_birth || null,
    languages: profile?.languages || [],
    preferences: profile?.preferences || {},
    notification_settings: profile?.notification_settings || {
      emailNotifications: true,
      pushNotifications: true,
      tripReminders: true,
      dealAlerts: true,
      socialNotifications: true,
      marketingNotifications: true, // opt-out: subscribed by default; false is written ONLY on an explicit unsubscribe, making it a reliable opt-out signal
      quietHoursStart: 22,
      quietHoursEnd: 8,
    },
    privacy_settings: profile?.privacy_settings || {
      privateProfile: false,
      showRealName: true,
      showTripHistory: false,
      showActivityStatus: true,
      showLocation: false,
      allowLocationTracking: false,
      disableFriendRequests: false,
    },
    created_at: profile?.created_at || user.created_at,
    last_sign_in_at: profile?.last_sign_in_at || null,
  };

  // Beta access info. Active only while unexpired, the same rule
  // lib/early-access and lib/usage-limits enforce: an expired row gives no
  // extra access, so the card must not say it does. Limits are shown
  // as stored; a null limit means the normal tier limit, not unlimited.
  const betaActive =
    !!betaAccess && (!betaAccess.expires_at || new Date(betaAccess.expires_at) > new Date());
  const betaAccessInfo = betaActive
    ? {
        hasBetaAccess: true,
        codeUsed: betaAccess.code_used,
        activatedAt: betaAccess.redeemed_at,
        limits: {
          generations: betaAccess.ai_generations_limit,
          regenerations: betaAccess.ai_regenerations_limit,
          assistant: betaAccess.ai_assistant_limit,
        },
      }
    : {
        hasBetaAccess: false,
        codeUsed: undefined,
        activatedAt: undefined,
      };

  // Google sign-ins have no password; they confirm a deletion with a code.
  const providers: unknown = user.app_metadata?.providers;
  const canUsePassword = Array.isArray(providers)
    ? providers.includes("email")
    : user.app_metadata?.provider === "email";

  return (
    <ProfileClient
      profile={userProfile}
      stats={tripStats}
      betaAccess={betaAccessInfo}
      canUsePassword={canUsePassword}
    />
  );
}
