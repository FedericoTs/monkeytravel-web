"use client";

import { useState, useEffect, Suspense } from "react";
import { createClient } from "@/lib/supabase/client";
import { useSearchParams } from "next/navigation";
import { useRouter, Link } from "@/lib/i18n/routing";
import { useLocale, useTranslations } from "next-intl";
import Image from "next/image";
import { trackSignup, setUserId } from "@/lib/analytics";
import { captureUserSignedUp } from "@/lib/posthog/events";
import { identify, aliasAnonToUser } from "@/lib/posthog/identify";
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
import { safeNextOrDefault } from "@/lib/security/safe-next";

function SignupForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<AuthError | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [hasOnboardingPrefs, setHasOnboardingPrefs] = useState(false);
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const locale = useLocale();
  const t = useTranslations("auth.signup");

  // Get redirect URL and check if coming from onboarding.
  // safeNextOrDefault locks this to a relative path — without it
  // /auth/signup?redirect=https://evil.com would walk the user onto an
  // attacker clone immediately after the OAuth round-trip.
  const redirectUrl = safeNextOrDefault(searchParams.get("redirect"), "/trips/new");
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

  // Build the OAuth callback URL once so Google/Apple paths share the same
  // attribution (onboarding flag, referral code, locale). Extracting this
  // also prevents the two handlers from drifting apart on parameter shape
  // — every callback-consumed field needs to be in the URL for both.
  const buildOAuthCallback = () => {
    const callbackParams = new URLSearchParams({
      next: redirectUrl,
      ...(hasOnboardingPrefs && { from_onboarding: "true" }),
      ...(referralCode && { ref: referralCode }),
    });
    callbackParams.append("locale", locale);
    return `${window.location.origin}/auth/callback?${callbackParams.toString()}`;
  };

  // Sign up with Apple. App Store Rule 4.8 — Apple sign-in must be
  // offered alongside Google. Same flow as Apple on /auth/login;
  // duplicated rather than shared so the signup-specific UTM/referral
  // attribution survives the round-trip. See MOBILE_CONVERSION_PLAN.md
  // A3 for the Supabase + Apple Developer setup the user still needs
  // to complete before this button does anything beyond surfacing an
  // "Apple provider not configured" error.
  const handleAppleSignup = async () => {
    setAppleLoading(true);
    setError(null);

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: "apple",
      options: { redirectTo: buildOAuthCallback() },
    });

    if (authError) {
      setError(humanizeAuthError(authError.message));
      setAppleLoading(false);
    }
  };

  const handleGoogleSignup = async () => {
    setGoogleLoading(true);
    setError(null);

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: buildOAuthCallback(),
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
          // Persist the UI locale into auth user_metadata so the Supabase
          // "Send Email" hook can localize the confirmation email — the
          // users row may not be committed yet when that hook fires.
          locale,
        },
        // When a referral is present, forward it through the confirm-email
        // round-trip so the PKCE callback can attribute the signup server-side
        // (validated). Only set for referred signups so the default redirect
        // is untouched for everyone else.
        ...(referralCode && {
          emailRedirectTo: `${window.location.origin}/auth/callback?ref=${encodeURIComponent(referralCode)}&locale=${locale}`,
        }),
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

      // First-touch UTM attribution. Middleware writes `mt_utm_source`
      // with HttpOnly=false specifically so this client-side read works.
      // Whitelist + slice mirrors the middleware sanitization.
      const utmCookie = document.cookie
        .split("; ")
        .find((c) => c.startsWith("mt_utm_source="))
        ?.split("=")[1];
      const acquisitionSource = utmCookie
        ? decodeURIComponent(utmCookie).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || null
        : null;

      // Build profile data based on whether onboarding was completed
      const profileData: Record<string, unknown> = {
        id: data.user.id,
        email: email,
        display_name: displayName || email.split("@")[0],
        // UI language the user signed up in — drives the language we email
        // them in (users.preferred_language: 'en' | 'es' | 'it').
        preferred_language: locale,
        trial_ends_at: getTrialEndDate().toISOString(), // Keep trial for existing users compatibility
        is_pro: false,
        welcome_completed: true, // Email signup skips /welcome and lands directly in the wizard
        privacy_settings: {
          showLocation: false,
          showRealName: true,
          privateProfile: false,
          showTripHistory: false,
          showActivityStatus: true,
          allowLocationTracking: false,
          disableFriendRequests: false,
        },
        // Referral attribution is handled server-side after signup (the
        // validated attach RPC — via emailRedirectTo for confirm-email, or
        // /api/referral/attach for instant sessions), not an unvalidated stamp.
        // Add acquisition source from first-touch UTM cookie
        ...(acquisitionSource && { acquisition_source: acquisitionSource }),
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
          marketingNotifications: true, // opt-out: subscribed by default; false is written ONLY on an explicit unsubscribe, making it a reliable opt-out signal
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
          marketingNotifications: true, // opt-out: subscribed by default; false is written ONLY on an explicit unsubscribe, making it a reliable opt-out signal
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

      // PostHog (task #207) — fire-and-forget. NEVER block the redirect
      // on these: the SDK lazy-loads and a slow network shouldn't park
      // the user on the signup form post-submit.
      const userId = data.user.id;
      const userEmail = data.user.email ?? email;
      // Alias FIRST so the captureUserSignedUp event lands on the merged
      // identity instead of the soon-to-be-orphaned anon distinct_id.
      aliasAnonToUser(userId).catch(() => {
        /* posthog not loaded — drop */
      });
      identify(userId, {
        email: userEmail,
        name: displayName || undefined,
        signupMethod: "email",
        locale,
      }).catch(() => {
        /* posthog not loaded — SessionTracker will identify next visit */
      });
      captureUserSignedUp({
        method: "email",
        ...(referralCode && { referral_code: referralCode }),
        from_onboarding: fromOnboarding,
      }).catch(() => {
        /* posthog not loaded — event dropped, GA4 still captured above */
      });
    }

    // If email confirmation is disabled, drop the user straight into the
    // trip wizard — mirrors the OAuth flow (app/auth/callback/route.ts)
    // which also bypasses /welcome and lands in /trips/new.
    if (data.session) {
      // Instant session (email confirmation disabled): the user is authed now,
      // so attach the referral server-side (validated; grants the welcome 🍌).
      // Fire-and-forget — never park the user on the form.
      if (referralCode) {
        fetch("/api/referral/attach", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: referralCode }),
        }).catch(() => {
          /* non-blocking — the confirm-email path attaches via the callback */
        });
      }
      router.push("/trips/new?auth_event=signup_email");
      router.refresh();
    }
  };

  const handleResendEmail = async () => {
    setResending(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.resend({
        type: "signup",
        email,
      });
      if (error) throw error;
      setResent(true);
    } catch {
      // Silently handle — don't expose whether email exists
    } finally {
      setResending(false);
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
                {t("checkEmailTitle")}
              </h1>
              <p className="text-slate-600 mb-6">
                {t.rich("checkEmailMessage", {
                  email,
                  strong: (chunks) => <strong>{chunks}</strong>,
                })}
              </p>
              <div className="flex flex-col items-center gap-3">
                <Link
                  href="/auth/login"
                  className="text-[var(--primary)] font-medium hover:underline"
                >
                  {t("backToLogin")}
                </Link>
                <button
                  onClick={handleResendEmail}
                  disabled={resending || resent}
                  className="text-sm text-slate-500 hover:text-slate-700 transition-colors disabled:opacity-50"
                >
                  {resent
                    ? t("emailResent")
                    : resending
                    ? t("resendingEmail")
                    : t("resendEmail")}
                </button>
              </div>
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
              {hasOnboardingPrefs ? t("titleWithPrefs") : t("title")}
            </h1>
            <p className="text-slate-600 mb-6">
              {hasOnboardingPrefs
                ? t("subtitleWithPrefs")
                : t("subtitle")}
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
                      {t("referralInvited")}
                    </p>
                    <p className="text-xs text-amber-700">
                      {t("referralBenefit")}
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
                    {t("prefsReady")}
                  </span>
                </div>
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4" role="alert">
                <p className="font-medium">{error.message}</p>
                {error.suggestion && (
                  <p className="text-sm text-red-600 mt-1">{error.suggestion}</p>
                )}
              </div>
            )}

            {/* Sign up with Apple — App Store Rule 4.8. See login page
                for full rationale. Black button per Apple HIG; placed
                above Google so Apple-first iOS users see it without
                scrolling.

                2026-05-31 launch-readiness gate (same as login): only
                renders when NEXT_PUBLIC_APPLE_AUTH_ENABLED === "true".
                Hidden until operator configures Apple in Supabase. */}
            {process.env.NEXT_PUBLIC_APPLE_AUTH_ENABLED === "true" && (
            <button
              type="button"
              onClick={handleAppleSignup}
              disabled={appleLoading || googleLoading || loading}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-black text-white rounded-lg font-medium hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed mb-3"
              aria-label={t("appleButton")}
            >
              {appleLoading ? (
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
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
                </svg>
              )}
              {t("appleButton")}
            </button>
            )}

            {/* Google Sign Up */}
            <button
              type="button"
              onClick={handleGoogleSignup}
              disabled={googleLoading || appleLoading || loading}
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
              {t("googleButton")}
            </button>

            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-200"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-4 bg-white text-slate-500">{t("orContinueWithEmail")}</span>
              </div>
            </div>

            <form onSubmit={handleSignup} className="space-y-4">
              <div>
                <label
                  htmlFor="displayName"
                  className="block text-sm font-medium text-slate-700 mb-1"
                >
                  {t("nameLabel")} <span className="text-slate-400 font-normal">{t("nameOptional")}</span>
                </label>
                <input
                  id="displayName"
                  type="text"
                  autoComplete="name"
                  name="name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={50}
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-300 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 outline-none transition-colors"
                  placeholder={t("namePlaceholder")}
                />
              </div>

              <div>
                <label
                  htmlFor="email"
                  className={`block text-sm font-medium mb-1 ${
                    error?.field === 'email' ? 'text-red-600' : 'text-slate-700'
                  }`}
                >
                  {t("emailLabel")}
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  name="email"
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
                  placeholder={t("emailPlaceholder")}
                />
              </div>

              <div>
                <label
                  htmlFor="password"
                  className={`block text-sm font-medium mb-1 ${
                    error?.field === 'password' ? 'text-red-600' : 'text-slate-700'
                  }`}
                >
                  {t("passwordLabel")}
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  name="password"
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
                  placeholder={t("passwordPlaceholder")}
                />
                <p className="text-xs text-slate-500 mt-1">{t("passwordHint")}</p>
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
                    {t("creatingAccount")}
                  </>
                ) : (
                  t("submitButton")
                )}
              </button>
            </form>

            {/* Free trip benefit reminder */}
            {hasOnboardingPrefs && (
              <div className="mt-4 text-center">
                <p className="text-xs text-slate-500">
                  {t.rich("freeTripBenefit", {
                    strong: (chunks) => <strong>{chunks}</strong>,
                  })}
                </p>
              </div>
            )}

            <div className="mt-6 text-center">
              <p className="text-slate-600">
                {t("hasAccount")}{" "}
                <Link
                  href="/auth/login"
                  className="text-[var(--primary)] font-medium hover:underline"
                >
                  {t("signInLink")}
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
