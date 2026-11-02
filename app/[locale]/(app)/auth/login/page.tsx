"use client";

import { useState, Suspense } from "react";
import { createClient } from "@/lib/supabase/client";
import { useSearchParams } from "next/navigation";
import { useRouter, Link } from "@/lib/i18n/routing";
import { useLocale, useTranslations } from "next-intl";
import { trackLogin, setUserId } from "@/lib/analytics";
import { captureUserLoggedIn } from "@/lib/posthog/events";
import { identify, aliasAnonToUser } from "@/lib/posthog/identify";
import {
  humanizeAuthError,
  validateLoginForm,
  type AuthError,
} from "@/lib/auth-errors";
import { safeNextOrDefault } from "@/lib/security/safe-next";
import { returnsToPage } from "@/lib/auth/first-login";
import { splitLocalePrefix } from "@/lib/auth/callback-url";
import { withStoredReferral } from "@/lib/referral/client";
import { logWriteError } from "@/lib/supabase/log-write-error";
import { logReadError } from "@/lib/supabase/log-read-error";
import { OAuthButtons } from "@/components/auth/OAuthButtons";
import { AuthField, AuthPage, AuthPageLoading, AuthSubmitButton } from "@/components/auth/AuthPage";

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<AuthError | null>(null);
  const [loading, setLoading] = useState(false);
  // Resend-confirmation flow, shown only when sign-in failed BECAUSE the
  // address was never confirmed. See handleResendConfirmation.
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const locale = useLocale();
  const t = useTranslations("auth.login");
  const tLink = useTranslations("auth.linkErrors");
  // Reject absolute/protocol-relative URLs in `?redirect=` so attackers
  // can't dress a phishing target as a monkeytravel.app login link.
  // See lib/security/safe-next.ts.
  const redirect = safeNextOrDefault(searchParams.get("redirect"), "/trips");
  // Signing in on the way to a page (a trip, an invite, a shared trip) goes
  // back there, skipping the first-visit detours below.
  const hasDestination = returnsToPage(safeNextOrDefault(searchParams.get("redirect"), ""));
  const errorParam = searchParams.get("error");
  // /auth/callback now sends a stable code instead of prose. The most common
  // one by far is link_wrong_device_or_expired: a signup confirmation opened on
  // a different device than the one that started it, where PKCE has no
  // code_verifier to redeem. Those users used to be shown the untranslated
  // string "Could not authenticate" and simply left. Unknown/legacy values fall
  // through and render as before.
  const KNOWN_LINK_ERRORS = ["link_wrong_device_or_expired", "auth_incomplete"];
  const linkError = errorParam && KNOWN_LINK_ERRORS.includes(errorParam) ? errorParam : null;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResent(false);
    setResendError(null);

    // Client-side validation first
    const validationError = validateLoginForm(email, password);
    if (validationError) {
      setError(validationError);
      setLoading(false);
      return;
    }

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setError(humanizeAuthError(authError.message));
      setLoading(false);
    } else {
      // Track successful login
      trackLogin("email");
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUserId(user.id);

        // PostHog (task #207) — fire-and-forget so we never block the
        // redirect on analytics. The SDK lazy-loads; a stalled network
        // shouldn't park the user on /auth/login post-signin.
        const userId = user.id;
        const userEmail = user.email ?? email;
        aliasAnonToUser(userId).catch(() => {
          /* posthog not loaded — drop */
        });
        identify(userId, {
          email: userEmail,
          locale,
        }).catch(() => {
          /* posthog not loaded — SessionTracker will identify next visit */
        });
        captureUserLoggedIn({ method: "email" }).catch(() => {
          /* posthog not loaded — event dropped, GA4 still captured above */
        });

        // Check if user needs to complete welcome flow first
        const { data: profile } = logReadError("login: profile", await supabase
          .from("users")
          .select("welcome_completed, onboarding_completed, login_count")
          .eq("id", user.id)
          .single());

        // Increment login count for returning users
        if (profile) {
          logWriteError("login: login count", await supabase
            .from("users")
            .update({ login_count: (profile.login_count || 0) + 1 })
            .eq("id", user.id));
        }

        // New users need to see welcome page first (to enter beta code / join waitlist).
        // /welcome is retired (it redirects to the wizard) and most accounts
        // still have welcome_completed = false, so someone signing in from a
        // trip, an invite or a shared trip skips it and keeps where they were
        // going.
        if (profile && !profile.welcome_completed && !hasDestination) {
          router.push("/welcome");
          router.refresh();
          return;
        }

        // Users who completed welcome but not onboarding
        if (profile && !profile.onboarding_completed && !hasDestination) {
          router.push(`/onboarding?redirect=${encodeURIComponent(redirect)}`);
          router.refresh();
          return;
        }
      }
      // This router adds the page's language itself: a redirect that already
      // carries one (/it/trips/<id>) would become /it/it/..., a 404.
      router.push(splitLocalePrefix(redirect).rest);
      router.refresh();
    }
  };

  /**
   * Send a fresh confirmation link to someone who never confirmed.
   *
   * WHY THIS LIVES ON THE LOGIN PAGE
   * Some email signups never confirm: the confirmation email was sent, they
   * never signed in, and they are locked out of the account they created.
   *
   * They were told "check your inbox for the confirmation email", which is a
   * dead end when that message is weeks old and the link has expired. The only
   * resend button in the app was on the signup SUCCESS screen — ephemeral, gone
   * the moment they navigated away, and unreachable on a return visit. The
   * login page is the one place they come back to.
   *
   * Errors are SURFACED, not swallowed. The signup page's version swallows
   * everything in an empty catch commented "Silently handle", which hides the
   * auth rate limit — so a throttled user sees a button that does nothing.
   */
  const handleResendConfirmation = async () => {
    setResending(true);
    setResendError(null);
    try {
      const supabase = createClient();
      const { error: resendErr } = await supabase.auth.resend({
        type: "signup",
        email,
      });
      if (resendErr) {
        // Rate limiting is the failure a real person is most likely to hit,
        // and the least self-explanatory. Name it.
        const msg = resendErr.message ?? "";
        setResendError(
          /rate|429|too many/i.test(msg)
            ? t("resendRateLimited")
            : t("resendFailed")
        );
        return;
      }
      setResent(true);
    } catch {
      setResendError(t("resendFailed"));
    } finally {
      setResending(false);
    }
  };

  // Google/Apple create the account when there is none: a friend's stored
  // referral rides along (credited on a first arrival only).
  const oauthRedirect = () =>
    withStoredReferral(`${window.location.origin}/auth/callback?next=${encodeURIComponent(redirect)}&locale=${locale}`);

  return (
    <AuthPage>
      <h1 className="text-2xl font-bold text-slate-900 mb-2">
        {t("title")}
      </h1>
      <p className="text-slate-600 mb-6">
        {t("subtitle")}
      </p>

      {(error || errorParam) && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4" role="alert">
          <p className="font-medium">
            {error?.message ||
              (linkError ? tLink(`${linkError}.message`) : errorParam)}
          </p>
          {error?.suggestion ? (
            <p className="text-sm text-red-600 mt-1">{error.suggestion}</p>
          ) : linkError ? (
            <p className="text-sm text-red-600 mt-1">
              {tLink(`${linkError}.suggestion`)}
            </p>
          ) : null}
          {error?.message?.includes("incorrect") && (
            <Link href="/auth/forgot-password" className="text-sm text-[var(--primary-ink)] font-medium hover:underline mt-2 inline-block">
              {t("forgotPasswordLink")}
            </Link>
          )}

          {/* Offer a fresh link in BOTH dead ends, not just one.
              Originally this was gated only on email_not_confirmed,
              which Supabase returns after a password attempt with the
              CORRECT password — so it never rendered for the people who
              arrive here from a broken confirmation link, who are the
              larger group. Measured 2026-09-02: of the users who
              confirmed and still could not get a session, 18 of 18 had
              requested another confirmation link, 5 tried signing up
              again and 3 tried a password reset. Every one of them was
              looking for this button and could not see it.

              Gated on stable codes, never on message text, so a
              translation cannot silently switch it off. */}
          {(error?.code === "email_not_confirmed" || linkError) && (
            <div className="mt-3">
              {resent ? (
                <p className="text-sm text-green-700 font-medium">
                  {t("resendSent")}
                </p>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleResendConfirmation}
                    disabled={resending || !email}
                    className="text-sm font-semibold text-[var(--primary-ink)] underline underline-offset-2 hover:no-underline disabled:opacity-60 disabled:no-underline"
                  >
                    {resending ? t("resendSending") : t("resendConfirmation")}
                  </button>
                  {/* Arriving from a dead link means the form is empty,
                      so the button is disabled with no explanation
                      unless we say why. */}
                  {!email && (
                    <p className="text-sm text-red-600 mt-1">
                      {t("resendNeedsEmail")}
                    </p>
                  )}
                </>
              )}
              {resendError && (
                <p className="text-sm text-red-600 mt-1">{resendError}</p>
              )}
            </div>
          )}
        </div>
      )}

      <OAuthButtons
        redirectTo={oauthRedirect}
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

      <form onSubmit={handleLogin} className="space-y-4">
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
          autoComplete="current-password"
          label={t("passwordLabel")}
          labelAside={
            <Link
              href="/auth/forgot-password"
              className="text-sm text-[var(--primary-ink)] hover:underline"
            >
              {t("forgotPassword")}
            </Link>
          }
          invalid={error?.field === 'password'}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (error?.field === 'password') setError(null);
          }}
          required
          placeholder={t("passwordPlaceholder")}
        />

        <AuthSubmitButton loading={loading} loadingLabel={t("signingIn")}>
          {t("submitButton")}
        </AuthSubmitButton>
      </form>

      <div className="mt-6 text-center">
        <p className="text-slate-600">
          {t("noAccount")}{" "}
          <Link
            href="/auth/signup"
            className="text-[var(--primary-ink)] font-medium hover:underline"
          >
            {t("signUpLink")}
          </Link>
        </p>
      </div>
    </AuthPage>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<AuthPageLoading />}>
      <LoginForm />
    </Suspense>
  );
}
