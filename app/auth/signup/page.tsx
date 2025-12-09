"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { trackSignup, setUserId } from "@/lib/analytics";
import { getTrialEndDate } from "@/lib/trial";
import {
  getLocalOnboardingPreferences,
  clearLocalOnboardingPreferences,
  hasLocalOnboardingPreferences,
} from "@/hooks/useOnboardingPreferences";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [hasOnboardingPrefs, setHasOnboardingPrefs] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  // Get redirect URL and check if coming from onboarding
  const redirectUrl = searchParams.get("redirect") || "/trips/new";
  const fromOnboarding = searchParams.get("from") === "onboarding";

  // Check for localStorage preferences on mount
  useEffect(() => {
    setHasOnboardingPrefs(hasLocalOnboardingPreferences());
  }, []);

  const handleGoogleSignup = async () => {
    setGoogleLoading(true);
    setError(null);

    // Pass onboarding status to callback
    const callbackParams = new URLSearchParams({
      next: redirectUrl,
      ...(hasOnboardingPrefs && { from_onboarding: "true" }),
    });

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?${callbackParams.toString()}`,
      },
    });

    if (error) {
      setError(error.message);
      setGoogleLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      setLoading(false);
      return;
    }

    const supabase = createClient();

    // Sign up the user
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          display_name: displayName,
        },
      },
    });

    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }

    // If we have a user, create their profile
    if (data.user) {
      // Check for localStorage onboarding preferences
      const localPrefs = getLocalOnboardingPreferences();
      const hasCompletedOnboarding = localPrefs?.completedAt !== null;

      // Build profile data based on whether onboarding was completed
      const profileData: Record<string, unknown> = {
        id: data.user.id,
        email: email,
        display_name: displayName || email.split("@")[0],
        trial_ends_at: getTrialEndDate().toISOString(), // Keep trial for existing users compatibility
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
      };

      if (localPrefs && hasCompletedOnboarding) {
        // User completed onboarding BEFORE signup - use their preferences
        profileData.preferences = {
          travelStyles: localPrefs.travelStyles,
          dietaryPreferences: localPrefs.dietaryPreferences,
          accessibilityNeeds: localPrefs.accessibilityNeeds,
        };
        profileData.notification_settings = {
          dealAlerts: true,
          tripReminders: true,
          pushNotifications: true,
          emailNotifications: true,
          socialNotifications: true,
          marketingNotifications: false,
          // Store as quiet hours (inverse of active hours)
          quietHoursStart: localPrefs.activeHoursEnd,
          quietHoursEnd: localPrefs.activeHoursStart,
        };
        profileData.onboarding_completed = true;
        // Grant 1 free trip for new users who completed onboarding
        profileData.free_trips_remaining = 1;
      } else {
        // No onboarding done - use defaults
        profileData.preferences = {};
        profileData.notification_settings = {
          dealAlerts: true,
          quietHoursEnd: 8,
          tripReminders: true,
          quietHoursStart: 22,
          pushNotifications: true,
          emailNotifications: true,
          socialNotifications: true,
          marketingNotifications: false,
        };
        profileData.onboarding_completed = false;
        // No free trips if onboarding not completed
        profileData.free_trips_remaining = 0;
      }

      const { error: profileError } = await supabase
        .from("users")
        .upsert(profileData);

      if (profileError) {
        console.error("Profile creation error:", profileError);
        // Don't block signup if profile creation fails
      }

      // Clear localStorage preferences after successful profile creation
      if (hasCompletedOnboarding) {
        clearLocalOnboardingPreferences();
      }
    }

    setSuccess(true);
    setLoading(false);

    // Track successful signup
    trackSignup("email");
    if (data.user) {
      setUserId(data.user.id);
    }

    // If email confirmation is disabled, redirect appropriately
    if (data.session) {
      const localPrefs = getLocalOnboardingPreferences();
      const hasCompletedOnboarding = localPrefs?.completedAt !== null || fromOnboarding;

      if (hasCompletedOnboarding) {
        // Onboarding already done - go directly to trip creation
        router.push(redirectUrl);
      } else {
        // No onboarding - redirect to onboarding first
        const onboardingUrl = `/onboarding?redirect=${encodeURIComponent(redirectUrl)}&auth_event=signup_email`;
        router.push(onboardingUrl);
      }
      router.refresh();
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white flex flex-col">
        <header className="p-4">
          <Link href="/" className="flex items-center gap-2">
            <Image
              src="/images/logo.png"
              alt="MonkeyTravel"
              width={40}
              height={40}
              className="rounded-lg"
            />
            <span className="font-bold text-xl text-[var(--primary)]">
              MonkeyTravel
            </span>
          </Link>
        </header>

        <div className="flex-1 flex items-center justify-center px-4">
          <div className="w-full max-w-md">
            <div className="bg-white rounded-2xl shadow-xl p-8 border border-slate-200 text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg
                  className="w-8 h-8 text-green-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-slate-900 mb-2">
                Check your email
              </h1>
              <p className="text-slate-600 mb-6">
                We sent a confirmation link to <strong>{email}</strong>. Click
                the link to activate your account.
              </p>
              <Link
                href="/auth/login"
                className="text-[var(--primary)] font-medium hover:underline"
              >
                Back to login
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white flex flex-col">
      {/* Header */}
      <header className="p-4">
        <Link href="/" className="flex items-center gap-2">
          <Image
            src="/images/logo.png"
            alt="MonkeyTravel"
            width={40}
            height={40}
            className="rounded-lg"
          />
          <span className="font-bold text-xl text-[var(--primary)]">
            MonkeyTravel
          </span>
        </Link>
      </header>

      {/* Signup Form */}
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-xl p-8 border border-slate-200">
            <h1 className="text-2xl font-bold text-slate-900 mb-2">
              {hasOnboardingPrefs ? "Almost there!" : "Create your account"}
            </h1>
            <p className="text-slate-600 mb-6">
              {hasOnboardingPrefs
                ? "Your preferences are saved. Create an account to start planning!"
                : "Start planning AI-powered trips today"}
            </p>

            {/* Show preferences saved badge if from onboarding */}
            {hasOnboardingPrefs && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 mb-6">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-sm font-medium text-emerald-800">
                    Your travel preferences are ready to use
                  </span>
                </div>
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">
                {error}
              </div>
            )}

            {/* Google Sign Up */}
            <button
              type="button"
              onClick={handleGoogleSignup}
              disabled={googleLoading || loading}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-slate-300 rounded-lg font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {googleLoading ? (
                <svg
                  className="animate-spin h-5 w-5"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
              ) : (
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
              )}
              Continue with Google
            </button>

            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-200"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-4 bg-white text-slate-500">or continue with email</span>
              </div>
            </div>

            <form onSubmit={handleSignup} className="space-y-4">
              <div>
                <label
                  htmlFor="displayName"
                  className="block text-sm font-medium text-slate-700 mb-1"
                >
                  Display Name
                </label>
                <input
                  id="displayName"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-300 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 outline-none transition-colors"
                  placeholder="Your name"
                />
              </div>

              <div>
                <label
                  htmlFor="email"
                  className="block text-sm font-medium text-slate-700 mb-1"
                >
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-300 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 outline-none transition-colors"
                  placeholder="you@example.com"
                />
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="block text-sm font-medium text-slate-700 mb-1"
                >
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-300 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 outline-none transition-colors"
                  placeholder="At least 6 characters"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-[var(--primary)] text-white py-3 rounded-lg font-medium hover:bg-[var(--primary)]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <svg
                      className="animate-spin h-5 w-5"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Creating account...
                  </>
                ) : (
                  "Create account"
                )}
              </button>
            </form>

            {/* Free trip benefit reminder */}
            {hasOnboardingPrefs && (
              <div className="mt-4 text-center">
                <p className="text-xs text-slate-500">
                  You'll get <strong className="text-emerald-600">1 free personalized trip</strong> when you sign up!
                </p>
              </div>
            )}

            <div className="mt-6 text-center">
              <p className="text-slate-600">
                Already have an account?{" "}
                <Link
                  href="/auth/login"
                  className="text-[var(--primary)] font-medium hover:underline"
                >
                  Sign in
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
