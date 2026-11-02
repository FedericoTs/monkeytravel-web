"use client";

import { useState, useEffect, Suspense } from "react";
import { createClient } from "@/lib/supabase/client";
import { useSearchParams } from "next/navigation";
import { Link } from "@/lib/i18n/routing";
import { useLocale, useTranslations } from "next-intl";
import { AuthPage, AuthPageLoading, AuthStatusIcon, AuthSubmitButton } from "@/components/auth/AuthPage";

function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const searchParams = useSearchParams();
  const locale = useLocale();
  const t = useTranslations("auth.resetPassword");

  // Helper to get locale-prefixed URL for email redirects
  const getLocaleUrl = (path: string) => {
    const baseUrl = window.location.origin;
    if (locale === "en") {
      return `${baseUrl}${path}`;
    }
    return `${baseUrl}/${locale}${path}`;
  };

  // Check for error params from auth callback
  useEffect(() => {
    const errorParam = searchParams.get("error");
    if (errorParam) {
      setError(decodeURIComponent(errorParam));
    }
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (!email || !email.includes("@")) {
      setError(t("invalidEmail"));
      setLoading(false);
      return;
    }

    const supabase = createClient();

    // Land the user DIRECTLY on the set-new-password page.
    //
    // Why not /auth/callback: the recovery email points at Supabase's
    // `/auth/v1/verify`, which consumes the token itself and 303s to
    // `redirect_to` with the session in the URL *fragment*
    // (`#access_token=...`). Fragments are never sent to the server, so
    // /auth/callback — a route handler — saw token_hash=null, fell through
    // to its "Could not authenticate" branch, and bounced to /auth/login.
    // The fragment survived the bounce, the browser client silently
    // consumed it, and the user ended up *logged in but never asked for a
    // new password*. Their password was therefore never changed: 13 users
    // requested a reset and auth.audit_log_entries recorded zero
    // `user_modified` events. They then hit "incorrect password" forever.
    //
    // /auth/reset-password is a client page, so its browser client parses
    // the fragment (detectSessionInUrl) into the @supabase/ssr cookie
    // store and the set-password form actually renders.
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email,
      {
        redirectTo: getLocaleUrl("/auth/reset-password"),
      }
    );

    if (resetError) {
      setError(resetError.message);
      setLoading(false);
    } else {
      setSuccess(true);
      setLoading(false);
    }
  };

  if (success) {
    return (
      <AuthPage centered>
        <AuthStatusIcon status="emailed" />
        <h1 className="text-2xl font-bold text-slate-900 mb-2">
          {t("successTitle")}
        </h1>
        <p className="text-slate-600 mb-6">
          {t.rich("successMessage", {
            email,
            strong: (chunks) => <strong>{chunks}</strong>,
          })}
        </p>
        <p className="text-sm text-slate-500 mb-6">
          {t("checkSpam")}
        </p>
        <div className="space-y-3">
          <button
            onClick={() => {
              setSuccess(false);
              setEmail("");
            }}
            className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-slate-700 font-medium hover:bg-slate-50 transition-colors"
          >
            {t("tryAnother")}
          </button>
          <Link
            href="/auth/login"
            className="block w-full px-4 py-2.5 bg-[var(--primary)] text-white rounded-lg font-medium hover:bg-[var(--primary)]/90 transition-colors text-center"
          >
            {t("backToLogin")}
          </Link>
        </div>
      </AuthPage>
    );
  }

  return (
    <AuthPage>
      <h1 className="text-2xl font-bold text-slate-900 mb-2">
        {t("title")}
      </h1>
      <p className="text-slate-600 mb-6">
        {t("subtitle")}
      </p>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4" role="alert">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="email"
            className="block text-sm font-medium text-slate-700 mb-1"
          >
            {t("emailLabel")}
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            name="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full px-4 py-2.5 rounded-lg border border-slate-300 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 outline-none transition-colors"
            placeholder={t("emailPlaceholder")}
          />
        </div>

        <AuthSubmitButton loading={loading} loadingLabel={t("sending")}>
          {t("submitButton")}
        </AuthSubmitButton>
      </form>

      <div className="mt-6 text-center">
        <Link
          href="/auth/login"
          className="text-[var(--primary-ink)] font-medium hover:underline"
        >
          {t("backToLogin")}
        </Link>
      </div>
    </AuthPage>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={<AuthPageLoading />}>
      <ForgotPasswordForm />
    </Suspense>
  );
}
