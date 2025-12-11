"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { BetaCodeInput, WaitlistSignup } from "@/components/beta";
import { createClient } from "@/lib/supabase/client";

interface WelcomeClientProps {
  userId: string;
  displayName: string;
  email: string;
  hasBetaAccess: boolean;
  betaCodeUsed?: string;
  hasCompletedOnboarding: boolean;
  freeTripsRemaining: number;
  intendedDestination: string;
}

export default function WelcomeClient({
  userId,
  displayName,
  email,
  hasBetaAccess: initialHasBetaAccess,
  betaCodeUsed,
  hasCompletedOnboarding,
  freeTripsRemaining,
  intendedDestination,
}: WelcomeClientProps) {
  const router = useRouter();
  const [hasBetaAccess, setHasBetaAccess] = useState(initialHasBetaAccess);
  const [showBetaSuccess, setShowBetaSuccess] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);

  const handleBetaCodeSuccess = () => {
    setHasBetaAccess(true);
    setShowBetaSuccess(true);
  };

  const markWelcomeCompleted = async () => {
    const supabase = createClient();
    await supabase
      .from("users")
      .update({ welcome_completed: true })
      .eq("id", userId);
  };

  const handleContinue = async (skipOnboarding = false) => {
    setIsCompleting(true);

    // Mark welcome as completed
    await markWelcomeCompleted();

    // Determine where to go next - preserve the intended destination
    if (skipOnboarding || hasCompletedOnboarding) {
      router.push(intendedDestination);
    } else {
      router.push(`/onboarding?redirect=${encodeURIComponent(intendedDestination)}`);
    }
  };

  const handleSkip = async () => {
    setIsCompleting(true);
    await markWelcomeCompleted();

    // Preserve the intended destination
    if (hasCompletedOnboarding) {
      router.push(intendedDestination);
    } else {
      router.push(`/onboarding?redirect=${encodeURIComponent(intendedDestination)}`);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50/30">
      {/* Header */}
      <header className="p-4 sm:p-6">
        <Link href="/" className="inline-flex items-center gap-2">
          <Image
            src="/images/logo.png"
            alt="MonkeyTravel"
            width={40}
            height={40}
            className="rounded-lg"
          />
          <span className="font-bold text-xl text-[var(--primary)]">MonkeyTravel</span>
        </Link>
      </header>

      {/* Main Content */}
      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        {/* Welcome Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 mb-6 shadow-lg shadow-emerald-500/25">
            <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
            </svg>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-3">
            Welcome, {displayName}!
          </h1>
          <p className="text-lg text-slate-600">
            You're all set to start planning amazing trips with AI
          </p>
        </div>

        {/* Free Account Benefits */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-6 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
              <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="text-lg font-bold text-slate-900">Your Free Account Includes</h2>
          </div>

          <ul className="space-y-3">
            {[
              {
                icon: "sparkles",
                text: hasCompletedOnboarding
                  ? `${freeTripsRemaining} AI-generated trip${freeTripsRemaining !== 1 ? "s" : ""} ready to use`
                  : "1 AI-generated trip (after completing preferences)",
                highlight: true,
              },
              { icon: "bookmark", text: "Unlimited saved trips" },
              { icon: "template", text: "Access to curated trip templates" },
              { icon: "share", text: "Share trips with friends" },
              { icon: "download", text: "Export to PDF" },
            ].map((item, i) => (
              <li key={i} className={`flex items-center gap-3 ${item.highlight ? "text-emerald-700 font-medium" : "text-slate-600"}`}>
                <span className={`flex-shrink-0 ${item.highlight ? "text-emerald-500" : "text-slate-400"}`}>
                  {item.icon === "sparkles" && (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                    </svg>
                  )}
                  {item.icon === "bookmark" && (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                    </svg>
                  )}
                  {item.icon === "template" && (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
                    </svg>
                  )}
                  {item.icon === "share" && (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                    </svg>
                  )}
                  {item.icon === "download" && (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                  )}
                </span>
                {item.text}
              </li>
            ))}
          </ul>

          {!hasCompletedOnboarding && (
            <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-xl">
              <p className="text-sm text-amber-800">
                <strong>Tip:</strong> Complete your travel preferences to unlock your free AI trip and get personalized recommendations!
              </p>
            </div>
          )}
        </div>

        {/* Beta Access Section */}
        {hasBetaAccess ? (
          <div className="bg-gradient-to-r from-emerald-50 to-teal-50 rounded-2xl border border-emerald-200 p-6 mb-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center flex-shrink-0">
                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-bold text-emerald-800">Beta Access Active</h3>
                <p className="text-emerald-700">
                  {showBetaSuccess
                    ? "Welcome to the beta! You now have unlimited AI features."
                    : `You have unlimited access${betaCodeUsed ? ` (Code: ${betaCodeUsed})` : ""}`}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-6 mb-6">
            {/* Beta Code Input */}
            <BetaCodeInput
              onSuccess={handleBetaCodeSuccess}
              showBenefits={true}
            />

            {/* Waitlist Signup */}
            <WaitlistSignup
              userEmail={email}
              source="welcome_page"
            />
          </div>
        )}

        {/* Continue Buttons */}
        <div className="space-y-4">
          <button
            onClick={() => handleContinue(false)}
            disabled={isCompleting}
            className="w-full px-6 py-4 bg-[var(--accent)] text-[var(--primary-dark)] font-bold rounded-xl hover:bg-[var(--accent-light)] transition-all shadow-lg shadow-[var(--accent)]/30 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isCompleting ? (
              <>
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Loading...
              </>
            ) : (
              <>
                {hasCompletedOnboarding ? (
                  <>
                    Start Planning My Trip
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  </>
                ) : (
                  <>
                    Continue to Personalization
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  </>
                )}
              </>
            )}
          </button>

          <button
            onClick={handleSkip}
            disabled={isCompleting}
            className="w-full px-6 py-3 text-slate-600 font-medium hover:text-slate-900 transition-colors disabled:opacity-50"
          >
            Skip for now
          </button>

          <p className="text-center text-xs text-slate-500">
            You can always enter a beta code later in your{" "}
            <Link href="/profile" className="text-[var(--primary)] hover:underline">
              profile settings
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
