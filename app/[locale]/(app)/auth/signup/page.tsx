"use client";

import { useState, useEffect, Suspense } from "react";
import { createClient } from "@/lib/supabase/client";
import { useSearchParams } from "next/navigation";
import { useRouter, Link } from "@/lib/i18n/routing";
import { useLocale, useTranslations } from "next-intl";
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
import { buildAuthCallbackUrl, splitLocalePrefix } from "@/lib/auth/callback-url";
import { returnsToPage } from "@/lib/auth/first-login";
import { safeGet, safeSet } from "@/lib/safe-storage";
import { OAuthButtons } from "@/components/auth/OAuthButtons";
import { AuthField, AuthPage, AuthPageLoading, AuthStatusIcon, AuthSubmitButton } from "@/components/auth/AuthPage";

function SignupForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<AuthError | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);
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
  // Signing up on the way to a page (an invite, a shared trip) comes back
  // there; a plain signup lands in the wizard.
  const hasDestination = returnsToPage(safeNextOrDefault(searchParams.get("redirect"), ""));
  const fromOnboarding = searchParams.get("from") === "onboarding";

  // Check for localStorage preferences and referral code on mount
  useEffect(() => {
    setHasOnboardingPrefs(hasLocalOnboardingPreferences());

    // Get referral code from URL or localStorage.
    //
    // safeGet/safeSet, not bare access: Safari with "block all cookies" makes
    // the localStorage identifier unresolvable, so this throws inside an
    // effect — the same ReferenceError that took the LOGIN page down
    // (JAVASCRIPT-NEXTJS-28). Signup is the page where that matters most: a
    // visitor who cannot create an account cannot do anything at all.
    //
    // Degrading to "no stored code" is correct. The ?ref= URL still works, and
    // eligibility is verified server-side regardless.
    const urlRef = searchParams.get("ref");
    const storedRef = safeGet("referral_code");
    const code = urlRef || storedRef;

    if (code) {
      setReferralCode(code);
      safeSet("referral_code", code);
    }
  }, [searchParams]);

  // The OAuth callback URL carries the signup's attribution (onboarding
  // flag, referral code) and locale through the provider round trip.
  const buildOAuthCallback = () => {
    const callbackParams = new URLSearchParams({
      next: redirectUrl,
      ...(hasOnboardingPrefs && { from_onboarding: "true" }),
      ...(referralCode && { ref: referralCode }),
    });
    callbackParams.append("locale", locale);
    return `${window.location.origin}/auth/callback?${callbackParams.toString()}`;
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
        // (validated). A destination (an invite, a shared trip) travels the
        // same way, so the confirmation link ends there and not in the wizard.
        // Plain signups keep the default redirect.
        ...((referralCode || hasDestination) && {
          emailRedirectTo: (() => {
            const cb = new URL(buildAuthCallbackUrl(window.location.origin, { next: redirectUrl, locale }));
            if (referralCode) cb.searchParams.set("ref", referralCode);
            return cb.toString();
          })(),
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
      // This router adds the page's language itself; strip one already on the
      // destination or it doubles (/it/it/..., a 404).
      router.push(hasDestination ? splitLocalePrefix(redirectUrl).rest : "/trips/new?auth_event=signup_email");
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
    } catch (err) {
      // Do NOT swallow this.
      //
      // The old comment here was "Silently handle - don't expose whether email
      // exists". Enumeration is a real concern on a LOGIN form; it is not one
      // here, because this screen only renders after we have just created that
      // exact account. What the silence actually hid was the auth rate limit:
      // the user pressed a button, nothing happened, and no message explained
      // why.
      const msg = err instanceof Error ? err.message : "";
      setResendError(
        /rate|429|too many/i.test(msg)
          ? t("resendRateLimited")
          : t("resendFailed")
      );
    } finally {
      setResending(false);
    }
  };

  if (success) {
    return (
      <AuthPage centered>
        <AuthStatusIcon status="done" />
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
            href={hasDestination ? `/auth/login?redirect=${encodeURIComponent(redirectUrl)}` : "/auth/login"}
            className="text-[var(--primary-ink)] font-medium hover:underline"
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
          {resendError && (
            <p className="text-sm text-red-600 text-center" role="alert">
              {resendError}
            </p>
          )}
        </div>
      </AuthPage>
    );
  }

  return (
    <AuthPage>
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

      <OAuthButtons
        redirectTo={buildOAuthCallback}
        disabled={loading}
        setError={setError}
        appleLabel={t("appleButton")}
        googleLabel={t("googleButton")}
      />

      <div className="relative my-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-slate-200"></div>
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="px-4 bg-white text-slate-500">{t("orContinueWithEmail")}</span>
        </div>
      </div>

      <form onSubmit={handleSignup} className="space-y-4">
        <AuthField
          id="displayName"
          name="name"
          type="text"
          autoComplete="name"
          label={
            <>
              {t("nameLabel")} <span className="text-slate-500 font-normal">{t("nameOptional")}</span>
            </>
          }
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={50}
          placeholder={t("namePlaceholder")}
        />

        <AuthField
          id="email"
          type="email"
          autoComplete="email"
          label={t("emailLabel")}
          invalid={error?.field === 'email'}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (error?.field === 'email') setError(null);
          }}
          required
          placeholder={t("emailPlaceholder")}
        />

        <AuthField
          id="password"
          type="password"
          autoComplete="new-password"
          label={t("passwordLabel")}
          hint={t("passwordHint")}
          invalid={error?.field === 'password'}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (error?.field === 'password') setError(null);
          }}
          required
          minLength={6}
          placeholder={t("passwordPlaceholder")}
        />

        <AuthSubmitButton loading={loading} loadingLabel={t("creatingAccount")}>
          {t("submitButton")}
        </AuthSubmitButton>
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
            href={hasDestination ? `/auth/login?redirect=${encodeURIComponent(redirectUrl)}` : "/auth/login"}
            className="text-[var(--primary-ink)] font-medium hover:underline"
          >
            {t("signInLink")}
          </Link>
        </p>
      </div>
    </AuthPage>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={<AuthPageLoading />}>
      <SignupForm />
    </Suspense>
  );
}
