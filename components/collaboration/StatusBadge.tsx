"use client";

import { ActivityVotingStatus, ConsensusResult } from "@/types";
import { getConsensusDisplayInfo } from "@/lib/voting/consensus";

interface StatusBadgeProps {
  status: ActivityVotingStatus;
  consensus?: ConsensusResult | null;
  size?: "sm" | "md";
  showIcon?: boolean;
  className?: string;
}

const STATUS_STYLES: Record<
  ActivityVotingStatus,
  { label: string; color: string; bgColor: string; icon: string; pulse?: boolean }
> = {
  proposed: {
    label: "Proposed",
    color: "text-purple-600",
    bgColor: "bg-purple-100",
    icon: "sparkles",
  },
  voting: {
    label: "Voting",
    color: "text-blue-600",
    bgColor: "bg-blue-100",
    icon: "vote",
    pulse: true,
  },
  confirmed: {
    label: "Confirmed",
    color: "text-green-600",
    bgColor: "bg-green-100",
    icon: "check",
  },
  rejected: {
    label: "Not Included",
    color: "text-red-600",
    bgColor: "bg-red-100",
    icon: "x",
  },
  deadlock: {
    label: "Needs Decision",
    color: "text-amber-600",
    bgColor: "bg-amber-100",
    icon: "alert",
    pulse: true,
  },
  completed: {
    label: "Done",
    color: "text-slate-600",
    bgColor: "bg-slate-100",
    icon: "check-circle",
  },
  skipped: {
    label: "Skipped",
    color: "text-slate-500",
    bgColor: "bg-slate-100",
    icon: "skip",
  },
};

const ICONS: Record<string, React.ReactNode> = {
  sparkles: (
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
      />
    </svg>
  ),
  vote: (
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  ),
  check: (
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  ),
  x: (
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  ),
  alert: (
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
      />
    </svg>
  ),
  "check-circle": (
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  ),
  skip: (
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M13 5l7 7-7 7M5 5l7 7-7 7"
      />
    </svg>
  ),
  clock: (
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  ),
  "trending-up": (
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
    </svg>
  ),
};

export default function StatusBadge({
  status,
  consensus,
  size = "sm",
  showIcon = true,
  className = "",
}: StatusBadgeProps) {
  // Use consensus-based display if available and status is voting
  let displayData = STATUS_STYLES[status];

  if (consensus && (status === "voting" || status === "proposed")) {
    const consensusInfo = getConsensusDisplayInfo(consensus);
    displayData = {
      label: consensusInfo.label,
      color: consensusInfo.color,
      bgColor: consensusInfo.bgColor,
      icon: consensusInfo.icon,
      pulse: consensus.status === "voting",
    };
  }

  const sizeClasses = size === "sm" ? "text-xs px-2 py-0.5" : "text-sm px-3 py-1";

  return (
    <span
      className={`
        inline-flex items-center gap-1 rounded-full font-medium
        ${displayData.bgColor} ${displayData.color}
        ${sizeClasses}
        ${displayData.pulse ? "animate-pulse" : ""}
        ${className}
      `}
    >
      {showIcon && ICONS[displayData.icon]}
      {displayData.label}
    </span>
  );
}
