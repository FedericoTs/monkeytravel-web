"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter, Link } from "@/lib/i18n/routing";
import Image from "next/image";
import { Gift, Sparkles, MapPin, Calendar, Zap, Check, ChevronRight } from "lucide-react";
import { safeSet } from "@/lib/safe-storage";

interface ReferralLandingClientProps {
  code: string;
  /** Null when the referrer has no name to show. */
  referrerName: string | null;
  referrerAvatar?: string | null;
}

export default function ReferralLandingClient({
  code,
  referrerName,
  referrerAvatar,
}: ReferralLandingClientProps) {
  const t = useTranslations("common.referralLanding");
  const tFooter = useTranslations("common.footer");
  const router = useRouter();
  const [isTracking, setIsTracking] = useState(true);

  // Track the click on mount
  useEffect(() => {
    const trackClick = async () => {
      try {
        // Get UTM params from URL
        const params = new URLSearchParams(window.location.search);

        await fetch("/api/referral/click", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code,
            utm_source: params.get("utm_source"),
            utm_medium: params.get("utm_medium"),
            utm_campaign: params.get("utm_campaign"),
          }),
        });

        // Store referral code in localStorage for signup
        safeSet("referral_code", code);
      } catch (error) {
        console.error("Failed to track referral click:", error);
      } finally {
        setIsTracking(false);
      }
    };

    trackClick();
  }, [code]);

  const handleGetStarted = () => {
    // Store referral code and redirect to signup
    safeSet("referral_code", code);
    router.push(`/auth/signup?ref=${code}`);
  };

  // First name only; the fallback is shown whole.
  const firstName = referrerName?.split(" ")[0] || t("friendFallback");

  return (
    <div className="min-h-screen min-h-dvh bg-gradient-to-b from-slate-50 to-white">
      {/* Navbar — navbar-safe adds env(safe-area-inset-top) padding so
          the logo doesn't tuck under the iPhone notch / Dynamic Island
          inside the Capacitor WebView. Sibling fix to InviteAcceptClient. */}
      <nav className="navbar-safe fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-100">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Image
              src="/images/logo.png"
              alt="MonkeyTravel"
              width={32}
              height={32}
              className="w-8 h-8"
            />
            <span className="font-bold text-slate-900">MonkeyTravel</span>
          </Link>
          <Link
            href="/auth/login"
            className="text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
          >
            {t("signIn")}
          </Link>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="pt-24 pb-16">
        <div className="max-w-4xl mx-auto px-4">
          {/* Referrer badge */}
          <div className="flex justify-center mb-8">
            <div className="inline-flex items-center gap-3 px-5 py-2.5 bg-white rounded-full shadow-lg shadow-slate-200/50 border border-slate-100">
              {referrerAvatar ? (
                <Image
                  src={referrerAvatar}
                  alt={referrerName || firstName}
                  width={32}
                  height={32}
                  className="w-8 h-8 rounded-full"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
                  <span className="text-white text-sm font-bold">
                    {firstName.charAt(0).toUpperCase()}
                  </span>
                </div>
              )}
              <span className="text-slate-600">
                {t.rich("invitedYou", {
                  name: firstName,
                  strong: (chunks) => <strong className="text-slate-900">{chunks}</strong>,
                })}
              </span>
            </div>
          </div>

          {/* Main heading */}
          <div className="text-center mb-12">
            {/*
              The pitch is keeping trips, not unlocking them: anonymous visitors
              already plan without an account (lib/anonymous/rate-limit.ts), but
              those trips live only in that browser. An account gets 30 a month
              (TIER_LIMITS.free.aiGenerations).
            */}
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-slate-900 mb-6 leading-tight">
              {t("titleLead")}
              <br />
              {t.rich("titleOffer", {
                highlight: (chunks) => (
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-500 to-orange-500">
                    {chunks}
                  </span>
                ),
              })}
            </h1>
            <p className="text-xl text-slate-600 max-w-2xl mx-auto">
              {t("subtitle", { name: firstName })}
            </p>
          </div>

          {/* Gift card */}
          <div className="max-w-md mx-auto mb-12">
            <div className="bg-gradient-to-br from-amber-50 via-orange-50 to-rose-50 rounded-3xl p-8 shadow-xl shadow-orange-100/50 border border-orange-100">
              <div className="flex items-center justify-center mb-6">
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shadow-orange-300/50 rotate-3 hover:rotate-0 transition-transform">
                  <Gift className="w-10 h-10 text-white" />
                </div>
              </div>

              <div className="text-center mb-6">
                <h2 className="text-2xl font-bold text-slate-900 mb-2">
                  {t("whatYouGet")}
                </h2>
                <p className="text-slate-600">
                  {t("whatYouGetNote")}
                </p>
              </div>

              <div className="space-y-3 mb-8">
                <div className="flex items-center gap-3 bg-white/60 rounded-xl p-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                    <Check className="w-5 h-5 text-emerald-600" />
                  </div>
                  <span className="text-slate-700">{t("perks.itinerary")}</span>
                </div>
                <div className="flex items-center gap-3 bg-white/60 rounded-xl p-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                    <Check className="w-5 h-5 text-emerald-600" />
                  </div>
                  <span className="text-slate-700">{t("perks.days")}</span>
                </div>
                <div className="flex items-center gap-3 bg-white/60 rounded-xl p-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                    <Check className="w-5 h-5 text-emerald-600" />
                  </div>
                  <span className="text-slate-700">{t("perks.budget")}</span>
                </div>
                <div className="flex items-center gap-3 bg-white/60 rounded-xl p-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                    <Check className="w-5 h-5 text-emerald-600" />
                  </div>
                  <span className="text-slate-700">{t("perks.saved")}</span>
                </div>
              </div>

              <button
                onClick={handleGetStarted}
                disabled={isTracking}
                className="w-full px-8 py-4 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-semibold rounded-xl shadow-lg shadow-orange-300/50 transition-all hover:shadow-xl hover:-translate-y-0.5 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Sparkles className="w-5 h-5" />
                <span>{t("cta")}</span>
                <ChevronRight className="w-5 h-5" />
              </button>

              <p className="text-center text-sm text-slate-500 mt-4">
                {t("noCard")}
              </p>
            </div>
          </div>

          {/* Features grid */}
          <div className="grid md:grid-cols-3 gap-6 max-w-3xl mx-auto">
            <div className="text-center p-6">
              <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center mx-auto mb-4">
                <MapPin className="w-6 h-6 text-blue-600" />
              </div>
              <h3 className="font-semibold text-slate-900 mb-2">{t("features.anywhereTitle")}</h3>
              <p className="text-sm text-slate-600">
                {t("features.anywhereBody")}
              </p>
            </div>
            <div className="text-center p-6">
              <div className="w-12 h-12 rounded-xl bg-purple-100 flex items-center justify-center mx-auto mb-4">
                <Zap className="w-6 h-6 text-purple-600" />
              </div>
              <h3 className="font-semibold text-slate-900 mb-2">{t("features.aiTitle")}</h3>
              <p className="text-sm text-slate-600">
                {t("features.aiBody")}
              </p>
            </div>
            <div className="text-center p-6">
              <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center mx-auto mb-4">
                <Calendar className="w-6 h-6 text-emerald-600" />
              </div>
              <h3 className="font-semibold text-slate-900 mb-2">{t("features.editableTitle")}</h3>
              <p className="text-sm text-slate-600">
                {t("features.editableBody")}
              </p>
            </div>
          </div>

          {/* Social proof */}
          <div className="mt-16 text-center">
            <p className="text-sm text-slate-500 mb-4">{t("trusted")}</p>
            <div className="flex items-center justify-center gap-1">
              {[1, 2, 3, 4, 5].map((i) => (
                <svg
                  key={i}
                  className="w-5 h-5 text-amber-400"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
              ))}
              <span className="ml-2 text-slate-600 font-medium">{t("rating")}</span>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-8 border-t border-slate-100">
        <div className="max-w-6xl mx-auto px-4 text-center">
          <p className="text-sm text-slate-500">
            {tFooter("copyright", { year: new Date().getFullYear() })}
          </p>
        </div>
      </footer>
    </div>
  );
}
