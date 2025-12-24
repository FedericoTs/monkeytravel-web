"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { trackEarlyAccessRedeemed, trackBetaCodeAttempt } from "@/lib/analytics";

interface BetaCodeInputProps {
  onSuccess?: (access: BetaAccessResult) => void;
  onError?: (error: string) => void;
  variant?: "default" | "compact" | "inline";
  showBenefits?: boolean;
  className?: string;
}

interface BetaAccessResult {
  hasAccess: boolean;
  accessType: string;
  codeUsed?: string;
  limits?: {
    generations: { limit: number | null; used: number };
    regenerations: { limit: number | null; used: number };
    assistant: { limit: number | null; used: number };
  };
}

export default function BetaCodeInput({
  onSuccess,
  onError,
  variant = "default",
  showBenefits = true,
  className = "",
}: BetaCodeInputProps) {
  const t = useTranslations("common.beta.codeInput");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleRedeem = async () => {
    if (!code.trim()) {
      setError(t("enterCodeError"));
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/early-access/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim().toUpperCase() }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || t("redeemFailed"));
        onError?.(data.error || t("redeemFailed"));
        // Track failed attempt
        trackBetaCodeAttempt({
          code: code.trim().toUpperCase(),
          success: false,
          errorReason: data.error || "Unknown error",
        });
        setLoading(false);
        return;
      }

      // Track successful redemption
      trackBetaCodeAttempt({
        code: code.trim().toUpperCase(),
        success: true,
      });
      trackEarlyAccessRedeemed({
        codeId: data.access?.codeUsed || code.trim().toUpperCase(),
      });

      setSuccess(true);
      onSuccess?.(data.access);
    } catch (err) {
      const errorMessage = t("genericError");
      setError(errorMessage);
      onError?.(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !loading) {
      handleRedeem();
    }
  };

  if (success) {
    return (
      <div className={`${className}`}>
        <div className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
          <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <p className="font-semibold text-emerald-800">{t("successTitle")}</p>
            <p className="text-sm text-emerald-600">{t("successDescription")}</p>
          </div>
        </div>
      </div>
    );
  }

  if (variant === "compact") {
    return (
      <div className={`${className}`}>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder={t("placeholderCompact")}
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase());
              setError(null);
            }}
            onKeyDown={handleKeyDown}
            className={`flex-1 px-4 py-2.5 rounded-lg border ${
              error ? "border-red-300" : "border-slate-300"
            } focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 outline-none transition-colors font-mono uppercase`}
            maxLength={20}
            disabled={loading}
          />
          <button
            onClick={handleRedeem}
            disabled={loading || !code.trim()}
            className="px-5 py-2.5 bg-[var(--primary)] text-white font-semibold rounded-lg hover:bg-[var(--primary)]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {loading ? (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              t("unlock")
            )}
          </button>
        </div>
        {error && (
          <p className="text-sm text-red-600 mt-2">{error}</p>
        )}
      </div>
    );
  }

  if (variant === "inline") {
    return (
      <div className={`${className}`}>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            placeholder={t("placeholderInline")}
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase());
              setError(null);
            }}
            onKeyDown={handleKeyDown}
            className={`flex-1 px-4 py-3 rounded-xl border-2 ${
              error ? "border-red-300" : "border-slate-200"
            } focus:border-[var(--primary)] outline-none transition-colors font-mono uppercase text-center sm:text-left`}
            maxLength={20}
            disabled={loading}
          />
          <button
            onClick={handleRedeem}
            disabled={loading || !code.trim()}
            className="px-6 py-3 bg-[var(--accent)] text-[var(--primary-dark)] font-bold rounded-xl hover:bg-[var(--accent-light)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {t("unlocking")}
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                </svg>
                {t("unlockAccess")}
              </>
            )}
          </button>
        </div>
        {error && (
          <p className="text-sm text-red-600 mt-2 text-center sm:text-left">{error}</p>
        )}
      </div>
    );
  }

  // Default variant
  return (
    <div className={`${className}`}>
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <div className="flex items-start gap-4 mb-5">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center flex-shrink-0">
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900">{t("title")}</h3>
            <p className="text-sm text-slate-600 mt-1">
              {t("subtitle")}
            </p>
          </div>
        </div>

        {showBenefits && (
          <div className="mb-5 p-4 bg-slate-50 rounded-xl">
            <p className="text-sm font-medium text-slate-700 mb-2">{t("benefitsTitle")}</p>
            <ul className="space-y-1.5">
              {[
                t("benefits.unlimitedGenerations"),
                t("benefits.unlimitedAssistant"),
                t("benefits.prioritySupport"),
                t("benefits.earlyAccess"),
              ].map((benefit, i) => (
                <li key={i} className="flex items-center gap-2 text-sm text-slate-600">
                  <svg className="w-4 h-4 text-emerald-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  {benefit}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex gap-3">
          <input
            type="text"
            placeholder={t("placeholder")}
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase());
              setError(null);
            }}
            onKeyDown={handleKeyDown}
            className={`flex-1 px-4 py-3 rounded-xl border-2 ${
              error ? "border-red-300 focus:border-red-500" : "border-slate-200 focus:border-[var(--primary)]"
            } outline-none transition-colors font-mono uppercase tracking-wider`}
            maxLength={20}
            disabled={loading}
          />
          <button
            onClick={handleRedeem}
            disabled={loading || !code.trim()}
            className="px-6 py-3 bg-[var(--primary)] text-white font-semibold rounded-xl hover:bg-[var(--primary)]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 whitespace-nowrap"
          >
            {loading ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {t("checking")}
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                </svg>
                {t("unlock")}
              </>
            )}
          </button>
        </div>

        {error && (
          <div className="mt-3 flex items-start gap-2 text-sm text-red-600">
            <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
