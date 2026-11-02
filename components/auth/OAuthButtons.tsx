"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { humanizeAuthError, type AuthError } from "@/lib/auth-errors";
import { AppleLogo, GoogleLogo } from "./ProviderLogos";
import { Spinner } from "@/components/ui/Spinner";

type Provider = "apple" | "google";

/**
 * The Apple and Google buttons above the email form of the login and signup
 * pages. A click hands the browser to the provider, which comes back to
 * `redirectTo()`; a sign-in that cannot start is reported through `setError`.
 *
 * Apple comes first and in black: App Store Review Guideline 4.8 asks for
 * Sign in with Apple, no less prominent than another provider, and Apple's
 * guidelines ask for the black button on a light background. It shows only
 * when NEXT_PUBLIC_APPLE_AUTH_ENABLED is "true": until the Apple provider is
 * configured in Supabase, a click can only fail. The native app signs in with
 * Apple through its own plugin (docs/MOBILE_CONVERSION_PLAN.md, A3).
 */
export function OAuthButtons({
  redirectTo,
  disabled,
  setError,
  appleLabel,
  googleLabel,
}: {
  redirectTo: () => string;
  disabled: boolean;
  setError: (error: AuthError | null) => void;
  appleLabel: string;
  googleLabel: string;
}) {
  const [pending, setPending] = useState<Provider | null>(null);

  const signIn = async (provider: Provider) => {
    setPending(provider);
    setError(null);

    const { error } = await createClient().auth.signInWithOAuth({
      provider,
      options: { redirectTo: redirectTo() },
    });

    if (error) {
      setError(humanizeAuthError(error.message));
      setPending(null);
    }
  };

  return (
    <>
      {process.env.NEXT_PUBLIC_APPLE_AUTH_ENABLED === "true" && (
        <button
          type="button"
          onClick={() => signIn("apple")}
          disabled={pending !== null || disabled}
          className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-black text-white rounded-lg font-medium hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed mb-3"
          aria-label={appleLabel}
        >
          {pending === "apple" ? <Spinner className="w-5 h-5" /> : <AppleLogo />}
          {appleLabel}
        </button>
      )}

      <button
        type="button"
        onClick={() => signIn("google")}
        disabled={pending !== null || disabled}
        className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-slate-300 rounded-lg font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {pending === "google" ? <Spinner className="w-5 h-5" /> : <GoogleLogo />}
        {googleLabel}
      </button>
    </>
  );
}

