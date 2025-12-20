"use client";

import { motion } from "framer-motion";
import type { ProposalStatus, ProposalConsensusResult } from "@/types";

interface ProposalBadgeProps {
  status: ProposalStatus;
  consensus?: ProposalConsensusResult;
  size?: 'sm' | 'md';
  showPulse?: boolean;
}

const STATUS_CONFIG: Record<ProposalStatus, {
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
  icon: string;
}> = {
  pending: {
    label: 'Proposed',
    color: 'text-amber-700',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-200',
    icon: '💡',
  },
  voting: {
    label: 'Voting',
    color: 'text-blue-700',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    icon: '🗳️',
  },
  approved: {
    label: 'Approved',
    color: 'text-green-700',
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200',
    icon: '✅',
  },
  rejected: {
    label: 'Rejected',
    color: 'text-red-700',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
    icon: '❌',
  },
  withdrawn: {
    label: 'Withdrawn',
    color: 'text-gray-600',
    bgColor: 'bg-gray-50',
    borderColor: 'border-gray-200',
    icon: '↩️',
  },
  expired: {
    label: 'Expired',
    color: 'text-gray-500',
    bgColor: 'bg-gray-50',
    borderColor: 'border-gray-200',
    icon: '⏰',
  },
};

export function ProposalBadge({
  status,
  consensus,
  size = 'sm',
  showPulse = true,
}: ProposalBadgeProps) {
  const config = STATUS_CONFIG[status];

  // Override with consensus-specific labels for active proposals
  let displayLabel = config.label;
  let displayIcon = config.icon;

  if (consensus && (status === 'pending' || status === 'voting')) {
    switch (consensus.status) {
      case 'likely_approve':
        displayLabel = 'Trending Yes';
        displayIcon = '📈';
        break;
      case 'deadlock':
        displayLabel = 'Needs Decision';
        displayIcon = '⚠️';
        break;
    }
  }

  const isActive = status === 'pending' || status === 'voting';
  const sizeClasses = size === 'sm'
    ? 'text-xs px-2 py-0.5'
    : 'text-sm px-3 py-1';

  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`
        inline-flex items-center gap-1 rounded-full border
        ${config.bgColor} ${config.borderColor} ${config.color}
        ${sizeClasses}
        font-medium
      `}
    >
      <span>{displayIcon}</span>
      <span>{displayLabel}</span>
      {isActive && showPulse && (
        <motion.span
          animate={{ opacity: [1, 0.4, 1] }}
          transition={{ duration: 2, repeat: Infinity }}
          className={`w-1.5 h-1.5 rounded-full ${
            status === 'voting' ? 'bg-blue-500' : 'bg-amber-500'
          }`}
        />
      )}
    </motion.span>
  );
}

export function ProposalVoteSummary({
  approve,
  reject,
  total,
  size = 'sm',
}: {
  approve: number;
  reject: number;
  total: number;
  size?: 'sm' | 'md';
}) {
  if (total === 0) return null;

  const approvePercent = Math.round((approve / total) * 100);
  const textSize = size === 'sm' ? 'text-xs' : 'text-sm';

  return (
    <div className={`flex items-center gap-2 ${textSize}`}>
      <div className="flex items-center gap-1">
        <span className="text-green-600">✅</span>
        <span className="text-gray-600">{approve}</span>
      </div>
      <div className="w-12 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${approvePercent}%` }}
          transition={{ duration: 0.5 }}
          className="h-full bg-green-500 rounded-full"
        />
      </div>
      <div className="flex items-center gap-1">
        <span className="text-red-600">❌</span>
        <span className="text-gray-600">{reject}</span>
      </div>
    </div>
  );
}
