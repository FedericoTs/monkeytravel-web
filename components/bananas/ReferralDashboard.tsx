"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import BananaBalance from "./BananaBalance";
import TierProgress from "./TierProgress";
import TierBadge from "./TierBadge";
import type {
  BananasDashboardResponse,
  BananaTransaction,
  TierBadgeInfo,
} from "@/types/bananas";

interface ReferralDashboardProps {
  initialData?: BananasDashboardResponse;
  onShare?: () => void;
  className?: string;
}

export default function ReferralDashboard({
  initialData,
  onShare,
  className = "",
}: ReferralDashboardProps) {
  const t = useTranslations("bananas");
  const [data, setData] = useState<BananasDashboardResponse | null>(initialData ?? null);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "history" | "rewards">("overview");

  useEffect(() => {
    if (!initialData) {
      fetchDashboardData();
    }
  }, [initialData]);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/bananas");
      if (!response.ok) throw new Error("Failed to fetch dashboard data");
      const dashboardData = await response.json();
      setData(dashboardData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className={`animate-pulse space-y-4 ${className}`}>
        <div className="h-32 bg-slate-100 rounded-2xl" />
        <div className="h-48 bg-slate-100 rounded-2xl" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className={`bg-red-50 rounded-2xl p-4 text-red-600 ${className}`}>
        {error || t("errors.loadFailed")}
      </div>
    );
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getTransactionIcon = (type: BananaTransaction["transactionType"]) => {
    switch (type) {
      case "referral":
        return "👥";
      case "collaboration":
        return "🤝";
      case "tier_bonus":
        return "🎉";
      case "spend":
        return "🛒";
      case "trip_complete":
        return "✈️";
      default:
        return "🍌";
    }
  };

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Balance Card */}
      <BananaBalance
        balance={data.balance.available}
        expiringSoon={data.balance.expiringSoon}
        expiringDate={data.balance.expiringDate}
        variant="full"
      />

      {/* Tier Progress */}
      <TierProgress tierInfo={data.tier} />

      {/* Badges Collection */}
      {data.badges.some((b: TierBadgeInfo) => b.unlocked) && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <h3 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-3">
            {t("badges.title")}
          </h3>
          <div className="flex gap-2 flex-wrap">
            {data.badges.map((badge: TierBadgeInfo) => (
              <TierBadge
                key={badge.tier}
                tier={badge.tier}
                unlocked={badge.unlocked}
                size="lg"
              />
            ))}
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4 text-center">
          <p className="text-2xl font-bold text-slate-900">
            {data.referralStats.totalReferrals}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {t("stats.referrals")}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4 text-center">
          <p className="text-2xl font-bold text-slate-900">
            {data.referralStats.pendingReferrals}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {t("stats.pending")}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4 text-center">
          <p className="text-2xl font-bold text-amber-500">
            {data.referralStats.bananasEarned}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {t("stats.earned")}
          </p>
        </div>
      </div>

      {/* Recent Activity */}
      {data.recentTransactions.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <h3 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-3">
            {t("activity.title")}
          </h3>
          <div className="space-y-3">
            {data.recentTransactions.slice(0, 5).map((tx: BananaTransaction) => (
              <div
                key={tx.id}
                className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0"
              >
                <div className="flex items-center gap-3">
                  <span className="text-lg">{getTransactionIcon(tx.transactionType)}</span>
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {tx.description || t(`activity.types.${tx.transactionType}`)}
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatDate(tx.createdAt)}
                    </p>
                  </div>
                </div>
                <span
                  className={`font-semibold ${
                    tx.amount > 0 ? "text-green-600" : "text-red-500"
                  }`}
                >
                  {tx.amount > 0 ? "+" : ""}
                  {tx.amount}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Share CTA */}
      <button
        onClick={onShare}
        className="w-full bg-[var(--primary)] text-white rounded-xl py-4 px-6 font-semibold flex items-center justify-center gap-2 hover:bg-[var(--primary-dark)] transition-colors"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
        </svg>
        {t("cta.inviteFriends")}
      </button>
    </div>
  );
}
