"use client";

import { useState, useEffect, Suspense } from "react";
import { createClient } from "@/lib/supabase/client";
import { useSearchParams } from "next/navigation";
import { useRouter, Link } from "@/lib/i18n/routing";
import { useLocale } from "next-intl";
import Image from "next/image";
import { trackSignup, setUserId } from "@/lib/analytics";
import { getTrialEndDate } from "@/lib/trial";
import {
  getLocalOnboardingPreferences,
  clearLocalOnboardingPreferences,
  hasLocalOnboardingPreferences,
} from "@/hooks/useOnboardingPreferences";
import {
  humanizeAuthError,
  validateSignupForm,
  type AuthError,
} from "@/lib/auth-errors";

function SignupForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<AuthError | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [hasOnboardingPrefs, setHasOnboardingPrefs] = useState(false);
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const locale = useLocale();

  // Get redirect URL and check if coming from onboarding
  const redirectUrl = searchParams.get("redirect") || "/trips/new";
  const fromOnboarding = searchParams.get("from") === "onboarding";

  // Helper to get locale-prefixed URL for OAuth redirects
  const getLocaleUrl = (path: string) => {
    const baseUrl = window.location.origin;
    if (locale === "en") {
      return `${baseUrl}${path}`;
    }
    return `${baseUrl}/${locale}${path}`;
  };

  // Check for localStorage preferences and referral code on mount
  useEffect(() => {
    setHasOnboardingPrefs(hasLocalOnboardingPreferences());

    // Get referral code from URL or localStorage
    const urlRef = searchParams.get("ref");
    const storedRef = localStorage.getItem("referral_code");
    const code = urlRef || storedRef;

    if (code) {
      setReferralCode(code);
      // Store in localStorage for persistence across page reloads
      localStorage.setItem("referral_code", code);
    }
  }, [searchParams]);

  const handleGoogleSignup = async () => {
    setGoogleLoading(true);
    setError(null);

    // Pass onboarding status and referral code to callback
    const callbackParams = new URLSearchParams({
      next: redirectUrl,
      ...(hasOnboardingPrefs && { from_onboarding: "true" }),
      ...(referralCode && { ref: referralCode }),
    });

    // Add locale to callback params for locale-aware redirects
    callbackParams.append("locale", locale);

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?${callbackParams.toString()}`,
      },
    });

    if (authError) {
      setError(humanizeAuthError(authError.message));
      setGoogleLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // Client-side validation first
    const validationError = validateSignupForm(email, password, displayName);
    if (validationError) {
      setError(validationError);
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
      setError(humanizeAuthError(signUpError.message));
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
        welcome_completed: false, // New users need to see welcome page
        privacy_settings: {
          showLocation: false,
          showRealName: true,
          privateProfile: false,
          showTripHistory: false,
          showActivityStatus: true,
          allowLocationTracking: false,
          disableFriendRequests: false,
        },
        // Add referral code if present
        ...(referralCode && { referred_by_code: referralCode }),
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

    // If email confirmation is disabled, redirect to welcome page
    // Welcome page will then redirect to onboarding if needed
    if (data.session) {
      router.push("/welcome?auth_event=signup_email");
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

            {/* Show referral banner if coming from referral link */}
            {referralCode && (
              <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-4 mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-amber-800">
                      You've been invited!
                    </p>
                    <p className="text-xs text-amber-700">
                      Get 1 FREE AI trip when you sign up and create your first trip
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Show preferences saved badge if from onboarding */}
            {hasOnboardingPrefs && !referralCode && (
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
                <p className="font-medium">{error.message}</p>
                {error.suggestion && (
                  <p className="text-sm text-red-600 mt-1">{error.suggestion}</p>
                )}
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
                  Display Name <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <input
                  id="displayName"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={50}
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-300 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 outline-none transition-colors"
                  placeholder="Your name"
                />
              </div>

              <div>
                <label
                  htmlFor="email"
                  className={`block text-sm font-medium mb-1 ${
                    error?.field === 'email' ? 'text-red-600' : 'text-slate-700'
                  }`}
                >
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (error?.field === 'email') setError(null);
                  }}
                  required
                  className={`w-full px-4 py-2.5 rounded-lg border outline-none transition-colors ${
                    error?.field === 'email'
                      ? 'border-red-300 focus:border-red-500 focus:ring-2 focus:ring-red-200'
                      : 'border-slate-300 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20'
                  }`}
                  placeholder="you@example.com"
                />
              </div>

              <div>
                <label
                  htmlFor="password"
                  className={`block text-sm font-medium mb-1 ${
                    error?.field === 'password' ? 'text-red-600' : 'text-slate-700'
                  }`}
                >
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (error?.field === 'password') setError(null);
                  }}
                  required
                  minLength={6}
                  className={`w-full px-4 py-2.5 rounded-lg border outline-none transition-colors ${
                    error?.field === 'password'
                      ? 'border-red-300 focus:border-red-500 focus:ring-2 focus:ring-red-200'
                      : 'border-slate-300 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20'
                  }`}
                  placeholder="At least 6 characters"
                />
                <p className="text-xs text-slate-500 mt-1">Must be at least 6 characters</p>
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

export default function SignupPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white flex items-center justify-center">
          <div className="animate-spin h-8 w-8 border-2 border-[var(--primary)] border-t-transparent rounded-full" />
        </div>
      }
    >
      <SignupForm />
    </Suspense>
  );
}
