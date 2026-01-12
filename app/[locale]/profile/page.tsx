import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import ProfileClient from "./ProfileClient";

export const metadata = {
  title: "Profile | MonkeyTravel",
  description: "Manage your MonkeyTravel profile, preferences, and settings",
};

export default async function ProfilePage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login?redirect=/profile");
  }

  // Fetch user profile with all fields
  const { data: profile } = await supabase
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
    .single();

  // Fetch trip statistics (excluding archived trips)
  const { data: trips } = await supabase
    .from("trips")
    .select("id, start_date, end_date, status, itinerary")
    .eq("user_id", user.id)
    .or("is_archived.is.null,is_archived.eq.false");

  // Fetch beta access status
  const { data: betaAccess } = await supabase
    .from("user_tester_access")
    .select("code_used, created_at")
    .eq("user_id", user.id)
    .single();

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
      marketingNotifications: false,
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

  // Beta access info
  const betaAccessInfo = betaAccess
    ? {
        hasBetaAccess: true,
        codeUsed: betaAccess.code_used,
        activatedAt: betaAccess.created_at,
      }
    : {
        hasBetaAccess: false,
        codeUsed: undefined,
        activatedAt: undefined,
      };

  return <ProfileClient profile={userProfile} stats={tripStats} betaAccess={betaAccessInfo} />;
}
