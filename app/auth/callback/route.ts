import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { getTrialEndDate } from "@/lib/trial";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/trips";

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.user) {
      // Check if user profile exists, if not create one (for OAuth users)
      const { data: existingProfile } = await supabase
        .from("users")
        .select("id")
        .eq("id", data.user.id)
        .single();

      // Track whether this is a new user (signup) or returning user (login)
      const isNewUser = !existingProfile;

      if (isNewUser) {
        // Create profile for OAuth user
        const displayName =
          data.user.user_metadata?.full_name ||
          data.user.user_metadata?.name ||
          data.user.email?.split("@")[0] ||
          "User";

        await supabase.from("users").upsert({
          id: data.user.id,
          email: data.user.email,
          display_name: displayName,
          avatar_url: data.user.user_metadata?.avatar_url || null,
          preferences: {},
          onboarding_completed: false,
          trial_ends_at: getTrialEndDate().toISOString(), // 7-day trial
          is_pro: false,
          privacy_settings: {
            showLocation: false,
            showRealName: true,
            privateProfile: false,
            showTripHistory: false,
            showActivityStatus: true,
            allowLocationTracking: false,
            disableFriendRequests: false,
          },
          notification_settings: {
            dealAlerts: true,
            quietHoursEnd: 8,
            tripReminders: true,
            quietHoursStart: 22,
            pushNotifications: true,
            emailNotifications: true,
            socialNotifications: true,
            marketingNotifications: false,
          },
        });

        // Redirect new users to onboarding with their intended destination
        const onboardingUrl = `/onboarding?redirect=${encodeURIComponent(next)}&auth_event=signup_google`;
        return NextResponse.redirect(`${origin}${onboardingUrl}`);
      }

      // Returning users go directly to their destination
      const separator = next.includes("?") ? "&" : "?";
      const trackingParam = "auth_event=login_google";
      return NextResponse.redirect(`${origin}${next}${separator}${trackingParam}`);
    }
  }

  // Return the user to an error page with instructions
  return NextResponse.redirect(`${origin}/auth/login?error=Could not authenticate`);
}
