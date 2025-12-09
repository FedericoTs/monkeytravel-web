"use client";

import { AccessLevel, getTrialDaysRemaining } from "@/lib/trial";

interface UserBadgeProps {
  accessLevel: AccessLevel;
  trialEndsAt?: string | Date | null;
  size?: "sm" | "md";
  showDaysRemaining?: boolean;
}

export default function UserBadge({
  accessLevel,
  trialEndsAt,
  size = "md",
  showDaysRemaining = false,
}: UserBadgeProps) {
  const daysRemaining = trialEndsAt ? getTrialDaysRemaining(trialEndsAt) : 0;

  if (accessLevel === "pro") {
    return (
      <span
        className={`inline-flex items-center gap-1 font-semibold rounded-full bg-gradient-to-r from-amber-400 to-orange-500 text-white ${
          size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm"
        }`}
      >
        <svg
          className={size === "sm" ? "w-3 h-3" : "w-4 h-4"}
          fill="currentColor"
          viewBox="0 0 24 24"
        >
          <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
        </svg>
        PRO
      </span>
    );
  }

  if (accessLevel === "trial") {
    return (
      <span
        className={`inline-flex items-center gap-1 font-medium rounded-full bg-blue-100 text-blue-700 ${
          size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm"
        }`}
      >
        <svg
          className={size === "sm" ? "w-3 h-3" : "w-4 h-4"}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        {showDaysRemaining && daysRemaining > 0
          ? `Trial (${daysRemaining}d left)`
          : "Trial"}
      </span>
    );
  }

  // Free user - no badge or subtle indicator
  return (
    <span
      className={`inline-flex items-center font-medium rounded-full bg-slate-100 text-slate-500 ${
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm"
      }`}
    >
      Free
    </span>
  );
}
