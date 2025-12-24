"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";

interface EmptySlotCardProps {
  day: number;
  timeSlot?: 'morning' | 'afternoon' | 'evening';
  onPropose: () => void;
  disabled?: boolean;
  proposalCount?: number;
}

const TIME_SLOT_ICONS = {
  morning: '🌅',
  afternoon: '☀️',
  evening: '🌙',
};

export function EmptySlotCard({
  day: _day, // Reserved for future day-specific logic
  timeSlot,
  onPropose,
  disabled = false,
  proposalCount = 0,
}: EmptySlotCardProps) {
  const t = useTranslations("common.proposals");
  const hasProposals = proposalCount > 0;

  return (
    <motion.button
      whileHover={{ scale: disabled ? 1 : 1.02 }}
      whileTap={{ scale: disabled ? 1 : 0.98 }}
      onClick={onPropose}
      disabled={disabled}
      className={`
        w-full p-4 rounded-xl border-2 border-dashed
        transition-all duration-200
        ${disabled
          ? 'border-gray-200 bg-gray-50 cursor-not-allowed'
          : hasProposals
            ? 'border-blue-300 bg-blue-50 hover:border-blue-400 hover:bg-blue-100 cursor-pointer'
            : 'border-gray-300 bg-gray-50 hover:border-blue-400 hover:bg-blue-50 cursor-pointer'
        }
      `}
    >
      <div className="flex flex-col items-center gap-2">
        {/* Icon */}
        <motion.div
          animate={hasProposals ? { scale: [1, 1.1, 1] } : {}}
          transition={{ duration: 2, repeat: Infinity }}
          className={`
            w-10 h-10 rounded-full flex items-center justify-center
            ${hasProposals
              ? 'bg-blue-100 text-blue-600'
              : 'bg-gray-200 text-gray-500'
            }
          `}
        >
          {hasProposals ? (
            <span className="text-lg">🗳️</span>
          ) : (
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 6v6m0 0v6m0-6h6m-6 0H6"
              />
            </svg>
          )}
        </motion.div>

        {/* Text */}
        <div className="text-center">
          <p className={`text-sm font-medium ${
            hasProposals ? 'text-blue-700' : 'text-gray-600'
          }`}>
            {hasProposals
              ? (proposalCount > 1
                  ? t("emptySlot.proposalsHerePlural", { count: proposalCount })
                  : t("emptySlot.proposalsHere", { count: proposalCount }))
              : t("emptySlot.emptySlot")
            }
          </p>
          {timeSlot && (
            <p className="text-xs text-gray-500 mt-0.5">
              {TIME_SLOT_ICONS[timeSlot]} {t(`emptySlot.${timeSlot}`)}
            </p>
          )}
          <p className="text-xs text-gray-400 mt-1">
            {hasProposals ? t("emptySlot.tapToVote") : t("emptySlot.tapToPropose")}
          </p>
        </div>
      </div>
    </motion.button>
  );
}

/**
 * Inline version for activity lists
 */
export function EmptySlotInline({
  onPropose,
  disabled = false,
}: {
  onPropose: () => void;
  disabled?: boolean;
}) {
  const t = useTranslations("common.proposals");
  return (
    <motion.button
      whileHover={{ scale: disabled ? 1 : 1.02 }}
      whileTap={{ scale: disabled ? 1 : 0.98 }}
      onClick={onPropose}
      disabled={disabled}
      className={`
        flex items-center gap-2 px-3 py-2 rounded-lg
        border border-dashed border-gray-300
        text-sm text-gray-500
        transition-all duration-200
        ${disabled
          ? 'opacity-50 cursor-not-allowed'
          : 'hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 cursor-pointer'
        }
      `}
    >
      <span className="text-lg">➕</span>
      <span>{t("emptySlot.proposeActivity")}</span>
    </motion.button>
  );
}
