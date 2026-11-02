"use client";

import { useState, useEffect, Suspense } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter, Link } from "@/lib/i18n/routing";
import { useTranslations } from "next-intl";
import { AuthField, AuthPage, AuthPageLoading, AuthStatusIcon, AuthSubmitButton } from "@/components/auth/AuthPage";

function ResetPasswordForm() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [hasValidSession, setHasValidSession] = useState(false);
  const router = useRouter();
  const t = useTranslations("auth.resetPassword");

  // Establish the recovery session that arrives from the email link.
  //
  // Supabase's /auth/v1/verify 303s here with the session in the URL
  // *fragment* (`#access_token=...&type=recovery`), which the browser
  // client consumes asynchronously via detectSessionInUrl. A single
  // immediate getSession() can therefore race the parse and render the
  // "invalid link" screen for a perfectly good link — so subscribe first,
  // then poll, and only give up after the fragment has had a beat.
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;

    const hash = typeof window !== "undefined" ? window.location.hash : "";

    // A dead link comes back as `#error=access_denied&error_code=otp_expired`.
    // Show the invalid-link screen rather than an empty form that cannot save.
    if (hash.includes("error=")) {
      setHasValidSession(false);
      setSessionChecked(true);
      return;
    }

    const accept = () => {
      if (cancelled) return;
      setHasValidSession(true);
      setSessionChecked(true);
    };

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) accept();
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      if (session) {
        accept();
        return;
      }
      // No session yet. If a fragment is present the client may still be
      // consuming it; the listener above will fire. Otherwise there is
      // nothing to wait for.
      if (hash.length > 1) {
        graceTimer = setTimeout(() => {
          if (!cancelled) setSessionChecked(true);
        }, 1500);
      } else {
        setSessionChecked(true);
      }
    });

    return () => {
      cancelled = true;
      if (graceTimer) clearTimeout(graceTimer);
      sub.subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // Validation
    if (password.length < 6) {
      setError(t("passwordTooShort"));
      setLoading(false);
      return;
    }

    if (password !== confirmPassword) {
      setError(t("passwordMismatch"));
      setLoading(false);
      return;
    }

    const supabase = createClient();

    const { error: updateError } = await supabase.auth.updateUser({
      password: password,
    });

    if (updateError) {
      setError(updateError.message);
      setLoading(false);
    } else {
      setSuccess(true);
      setLoading(false);

      // Redirect to trips after 2 seconds
      setTimeout(() => {
        router.push("/trips");
        router.refresh();
      }, 2000);
    }
  };

  // Show loading while checking session
  if (!sessionChecked) {
    return <AuthPageLoading />;
  }

  // No valid session - show error
  if (!hasValidSession) {
    return (
      <AuthPage centered>
        <AuthStatusIcon status="broken" />
        <h1 className="text-2xl font-bold text-slate-900 mb-2">
          {t("invalidLinkTitle")}
        </h1>
        <p className="text-slate-600 mb-6">
          {t("invalidLinkMessage")}
        </p>
        <div className="space-y-3">
          <Link
            href="/auth/forgot-password"
            className="block w-full px-4 py-2.5 bg-[var(--primary)] text-white rounded-lg font-medium hover:bg-[var(--primary)]/90 transition-colors text-center"
          >
            {t("requestNewLink")}
          </Link>
          <Link
            href="/auth/login"
            className="block w-full px-4 py-2.5 border border-slate-300 rounded-lg text-slate-700 font-medium hover:bg-slate-50 transition-colors text-center"
          >
            {t("backToLogin")}
          </Link>
        </div>
      </AuthPage>
    );
  }

  // Success state
  if (success) {
    return (
      <AuthPage centered>
        <AuthStatusIcon status="done" />
        <h1 className="text-2xl font-bold text-slate-900 mb-2">
          {t("successUpdateTitle")}
        </h1>
        <p className="text-slate-600 mb-6">
          {t("successUpdateMessage")}
        </p>
        <div className="animate-spin h-6 w-6 border-2 border-[var(--primary)] border-t-transparent rounded-full mx-auto" />
      </AuthPage>
    );
  }

  return (
    <AuthPage>
      <h1 className="text-2xl font-bold text-slate-900 mb-2">
        {t("setNewTitle")}
      </h1>
      <p className="text-slate-600 mb-6">
        {t("setNewSubtitle")}
      </p>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4" role="alert">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthField
          id="password"
          type="password"
          autoComplete="new-password"
          label={t("newPasswordLabel")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
          placeholder={t("newPasswordPlaceholder")}
        />

        <AuthField
          id="confirmPassword"
          type="password"
          autoComplete="new-password"
          label={t("confirmPasswordLabel")}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          minLength={6}
          placeholder={t("confirmPasswordPlaceholder")}
        />

        <AuthSubmitButton loading={loading} loadingLabel={t("updating")}>
          {t("updateButton")}
        </AuthSubmitButton>
      </form>
    </AuthPage>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<AuthPageLoading />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
