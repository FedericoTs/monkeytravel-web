"use client";

import { useTranslations } from "next-intl";

interface BananaBalanceProps {
  balance: number;
  expiringSoon?: number;
  expiringDate?: string;
  variant?: "compact" | "full";
  className?: string;
}

export default function BananaBalance({
  balance,
  expiringSoon,
  expiringDate,
  variant = "compact",
  className = "",
}: BananaBalanceProps) {
  const t = useTranslations("bananas");

  const formatExpiryDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  };

  if (variant === "compact") {
    return (
      <div className={`flex items-center gap-1.5 ${className}`}>
        <span className="text-lg">🍌</span>
        <span className="font-semibold text-slate-900">{balance.toLocaleString()}</span>
      </div>
    );
  }

  return (
    <div className={`bg-gradient-to-br from-amber-50 to-yellow-50 rounded-2xl p-5 ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-slate-600 text-sm font-medium">
          {t("balance.title")}
        </span>
        <span className="text-2xl">🍌</span>
      </div>

      <div className="flex items-baseline gap-2">
        <span className="text-4xl font-bold text-slate-900">
          {balance.toLocaleString()}
        </span>
        <span className="text-slate-500 text-sm">
          {t("balance.bananas")}
        </span>
      </div>

      {expiringSoon && expiringSoon > 0 && expiringDate && (
        <div className="mt-3 flex items-center gap-2 text-sm text-amber-700 bg-amber-100/50 rounded-lg px-3 py-2">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>
            {t("balance.expiring", {
              count: expiringSoon,
              date: formatExpiryDate(expiringDate),
            })}
          </span>
        </div>
      )}
    </div>
  );
}
