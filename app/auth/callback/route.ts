import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { getTrialEndDate } from "@/lib/trial";
import type { EmailOtpType } from "@supabase/supabase-js";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/trips";
  const fromOnboarding = searchParams.get("from_onboarding") === "true";
  const referralCode = searchParams.get("ref");

  const supabase = await createClient();

  // Handle email confirmation/magic link tokens (PKCE flow)
  if (token_hash && type) {
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash,
      type,
    });

    if (!error && data.user) {
      // SPECIAL CASE: Password recovery - redirect to reset password page
      // The user is now authenticated with a session, so they can set a new password
      if (type === "recovery") {
        return NextResponse.redirect(`${origin}/auth/reset-password`);
      }

      // Check if user profile exists
      const { data: existingProfile } = await supabase
        .from("users")
        .select("id, onboarding_completed, welcome_completed, login_count")
        .eq("id", data.user.id)
        .single();

      // Email confirmation for new signup - profile was already created during signup
      // Just redirect them appropriately based on welcome/onboarding status
      // IMPORTANT: Preserve the original redirect URL so user returns to their intended destination
      const finalRedirect = next !== "/trips" ? next : "/trips/new"; // Prefer trips/new for new users

      if (existingProfile) {
        // Increment login_count for returning users (email confirmation/magic link)
        const { error: updateError } = await supabase
          .from("users")
          .update({
            login_count: ((existingProfile as { login_count?: number }).login_count || 0) + 1,
          })
          .eq("id", data.user.id);

        if (updateError) {
          console.error("[Auth Callback] Failed to increment login_count:", updateError.message);
        }

        // Check welcome status first (new flow)
        if (!existingProfile.welcome_completed) {
          // New user needs to see welcome page first - preserve intended destination
          return NextResponse.redirect(`${origin}/welcome?next=${encodeURIComponent(finalRedirect)}&auth_event=email_confirmed`);
        }

        if (existingProfile.onboarding_completed) {
          // Welcome and onboarding complete - go to intended destination
          const separator = finalRedirect.includes("?") ? "&" : "?";
          return NextResponse.redirect(`${origin}${finalRedirect}${separator}auth_event=email_confirmed`);
        } else {
          // Welcome done but needs onboarding - preserve destination for after onboarding
          const onboardingUrl = `/onboarding?redirect=${encodeURIComponent(finalRedirect)}&auth_event=email_confirmed`;
          return NextResponse.redirect(`${origin}${onboardingUrl}`);
        }
      }

      // Fallback: profile doesn't exist yet (edge case) - go to welcome with destination
      return NextResponse.redirect(`${origin}/welcome?next=${encodeURIComponent(finalRedirect)}&auth_event=email_confirmed`);
    }

    // Token verification failed
    console.error("[Auth Callback] Token verification failed:", error?.message);

    // Provide more specific error messages
    const errorMessage = type === "recovery"
      ? "Password reset link is invalid or expired. Please request a new one."
      : error?.message || "Email confirmation failed";

    const redirectPath = type === "recovery"
      ? `/auth/forgot-password?error=${encodeURIComponent(errorMessage)}`
      : `/auth/login?error=${encodeURIComponent(errorMessage)}`;

    return NextResponse.redirect(`${origin}${redirectPath}`);
  }

  // Handle OAuth code exchange
  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.user) {
      // Check if user profile exists, if not create one (for OAuth users)
      const { data: existingProfile } = await supabase
        .from("users")
        .select("id, login_count, profile_completed")
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

        // Check if user already completed onboarding before signup
        // If from_onboarding=true, they completed anonymous onboarding first
        const onboardingCompleted = fromOnboarding;
        const freeTripsRemaining = fromOnboarding ? 1 : 0;

        await supabase.from("users").upsert({
          id: data.user.id,
          email: data.user.email,
          display_name: displayName,
          avatar_url: data.user.user_metadata?.avatar_url || null,
          preferences: {}, // Will be filled by complete-profile page if from onboarding
          onboarding_completed: onboardingCompleted,
          free_trips_remaining: freeTripsRemaining,
          welcome_completed: false, // New users need to see welcome page
          trial_ends_at: getTrialEndDate().toISOString(), // 7-day trial for existing feature
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
          // Add referral code if present
          ...(referralCode && { referred_by_code: referralCode }),
        });

        // NEW: All new users go to /welcome first to enter beta code or join waitlist
        // The welcome page will then redirect to onboarding if needed
        // IMPORTANT: Preserve the original redirect URL so user returns to their intended destination
        const finalRedirect = next !== "/trips" ? next : "/trips/new"; // Prefer trips/new for new users

        if (fromOnboarding) {
          // User completed onboarding before signup - redirect to complete-profile first
          // to transfer localStorage preferences, then welcome
          const completeProfileUrl = `/auth/complete-profile?redirect=/welcome?next=${encodeURIComponent(finalRedirect)}&auth_event=signup_google`;
          return NextResponse.redirect(`${origin}${completeProfileUrl}`);
        } else {
          // New user - redirect to welcome page with original destination preserved
          return NextResponse.redirect(`${origin}/welcome?next=${encodeURIComponent(finalRedirect)}&auth_event=signup_google`);
        }
      }

      // Returning users - increment login count and go to destination
      const { error: updateError } = await supabase
        .from("users")
        .update({
          login_count: ((existingProfile as { login_count?: number }).login_count || 0) + 1,
        })
        .eq("id", data.user.id);

      if (updateError) {
        console.error("[Auth Callback] Failed to increment login_count (OAuth):", updateError.message);
      }

      const separator = next.includes("?") ? "&" : "?";
      const trackingParam = "auth_event=login_google";
      return NextResponse.redirect(`${origin}${next}${separator}${trackingParam}`);
    }
  }

  // Return the user to an error page with instructions
  return NextResponse.redirect(`${origin}/auth/login?error=Could not authenticate`);
}
