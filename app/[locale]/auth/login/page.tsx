"use client";

import { useState, Suspense } from "react";
import { createClient } from "@/lib/supabase/client";
import { useSearchParams } from "next/navigation";
import { useRouter, Link } from "@/lib/i18n/routing";
import { useLocale, useTranslations } from "next-intl";
import Image from "next/image";
import { trackLogin, setUserId } from "@/lib/analytics";
import {
  humanizeAuthError,
  validateLoginForm,
  type AuthError,
} from "@/lib/auth-errors";

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<AuthError | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const locale = useLocale();
  const t = useTranslations("auth.login");
  const redirect = searchParams.get("redirect") || "/trips";
  const errorParam = searchParams.get("error");

  // Helper to get locale-prefixed URL for OAuth redirects
  const getLocaleUrl = (path: string) => {
    const baseUrl = window.location.origin;
    if (locale === "en") {
      return `${baseUrl}${path}`;
    }
    return `${baseUrl}/${locale}${path}`;
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

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

        // Check if user needs to complete welcome flow first
        const { data: profile } = await supabase
          .from("users")
          .select("welcome_completed, onboarding_completed, login_count")
          .eq("id", user.id)
          .single();

        // Increment login count for returning users
        if (profile) {
          await supabase
            .from("users")
            .update({ login_count: (profile.login_count || 0) + 1 })
            .eq("id", user.id);
        }

        // New users need to see welcome page first (to enter beta code / join waitlist)
        if (profile && !profile.welcome_completed) {
          router.push("/welcome");
          router.refresh();
          return;
        }

        // Users who completed welcome but not onboarding
        if (profile && !profile.onboarding_completed) {
          router.push(`/onboarding?redirect=${encodeURIComponent(redirect)}`);
          router.refresh();
          return;
        }
      }
      router.push(redirect);
      router.refresh();
    }
  };

  const handleGoogleLogin = async () => {
    setGoogleLoading(true);
    setError(null);

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${redirect}&locale=${locale}`,
      },
    });

    if (authError) {
      setError(humanizeAuthError(authError.message));
      setGoogleLoading(false);
    }
  };

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

      {/* Login Form */}
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-xl p-8 border border-slate-200">
            <h1 className="text-2xl font-bold text-slate-900 mb-2">
              {t("title")}
            </h1>
            <p className="text-slate-600 mb-6">
              {t("subtitle")}
            </p>

            {(error || errorParam) && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">
                <p className="font-medium">{error?.message || errorParam}</p>
                {error?.suggestion && (
                  <p className="text-sm text-red-600 mt-1">{error.suggestion}</p>
                )}
              </div>
            )}

            {/* Google Sign In */}
            <button
              type="button"
              onClick={handleGoogleLogin}
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

            <form onSubmit={handleLogin} className="space-y-4">
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
                <div className="flex items-center justify-between mb-1">
                  <label
                    htmlFor="password"
                    className={`block text-sm font-medium ${
                      error?.field === 'password' ? 'text-red-600' : 'text-slate-700'
                    }`}
                  >
                    {t("passwordLabel")}
                  </label>
                  <Link
                    href="/auth/forgot-password"
                    className="text-sm text-[var(--primary)] hover:underline"
                  >
                    {t("forgotPassword")}
                  </Link>
                </div>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (error?.field === 'password') setError(null);
                  }}
                  required
                  className={`w-full px-4 py-2.5 rounded-lg border outline-none transition-colors ${
                    error?.field === 'password'
                      ? 'border-red-300 focus:border-red-500 focus:ring-2 focus:ring-red-200'
                      : 'border-slate-300 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20'
                  }`}
                  placeholder={t("passwordPlaceholder")}
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
                    {t("signingIn")}
                  </>
                ) : (
                  t("submitButton")
                )}
              </button>
            </form>

            <div className="mt-6 text-center">
              <p className="text-slate-600">
                {t("noAccount")}{" "}
                <Link
                  href="/auth/signup"
                  className="text-[var(--primary)] font-medium hover:underline"
                >
                  {t("signUpLink")}
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white flex items-center justify-center">
          <div className="animate-spin h-8 w-8 border-2 border-[var(--primary)] border-t-transparent rounded-full" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
