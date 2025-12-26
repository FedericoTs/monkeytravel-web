"use client";

import { memo } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Activity, VoteType, ActivityVote, ConsensusResult, ActivityVotingStatus } from "@/types";
import EditableActivityCard from "./EditableActivityCard";

interface SortableActivityCardProps {
  activity: Activity;
  index: number;
  currency?: string;
  showGallery?: boolean;
  isEditMode: boolean;
  onDelete: () => void;
  onUpdate: (updates: Partial<Activity>) => void;
  onMoveToDay: (dayIndex: number) => void;
  onRegenerate: () => void;
  availableDays: number[];
  currentDayIndex: number;
  isRegenerating?: boolean;
  disableAutoFetch?: boolean;
  onPhotoCapture?: (activityId: string, photoUrl: string) => void;
  // Voting props (passed through to EditableActivityCard)
  votingEnabled?: boolean;
  votes?: ActivityVote[];
  consensus?: ConsensusResult | null;
  activityStatus?: ActivityVotingStatus;
  currentUserVote?: VoteType | null;
  canVote?: boolean;
  totalVoters?: number;
  onVote?: (voteType: VoteType, comment?: string) => Promise<void>;
  onRemoveVote?: () => Promise<void>;
}

function SortableActivityCard({
  activity,
  ...props
}: SortableActivityCardProps) {
  const t = useTranslations("common.drag");
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isSorting,
  } = useSortable({
    id: activity.id || `activity-${props.index}`,
  });

  // iOS-style spring animation with custom easing
  const springTransition = isDragging
    ? "none" // No transition while actively dragging
    : "transform 350ms cubic-bezier(0.32, 0.72, 0, 1), opacity 200ms ease, box-shadow 200ms ease";

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: springTransition,
    zIndex: isDragging ? 100 : isSorting ? 10 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`
        relative transition-all
        ${isDragging
          ? "scale-[1.02] opacity-95"
          : "scale-100 opacity-100"
        }
      `}
    >
      {/* Floating elevation shadow layer - iOS style depth */}
      <div
        className={`
          absolute inset-0 rounded-xl transition-all duration-200
          ${isDragging
            ? "shadow-[0_20px_40px_-10px_rgba(0,0,0,0.25),0_10px_20px_-5px_rgba(0,0,0,0.15)] scale-[1.01]"
            : "shadow-none"
          }
        `}
        style={{ pointerEvents: "none" }}
      />

      {/* Main card container with drag handle */}
      <div
        className={`
          relative flex items-stretch rounded-xl overflow-hidden
          transition-all duration-200
          ${isDragging
            ? "ring-2 ring-[var(--primary)] ring-offset-2 bg-white"
            : ""
          }
        `}
      >
        {/* Integrated Drag Handle - Always visible in edit mode */}
        <div
          {...attributes}
          {...listeners}
          className={`
            flex-shrink-0 w-10 sm:w-12
            flex flex-col items-center justify-center gap-1
            cursor-grab active:cursor-grabbing
            touch-none select-none
            transition-all duration-200
            rounded-l-xl border border-r-0
            ${isDragging
              ? "bg-[var(--primary)] border-[var(--primary)] text-white"
              : "bg-gradient-to-r from-slate-100 to-slate-50 border-slate-200 hover:from-slate-200 hover:to-slate-100 text-slate-400 hover:text-slate-600"
            }
          `}
          style={{
            // Large touch target for mobile (>44px)
            minHeight: "100%",
          }}
          title={t("title")}
          aria-label={t("ariaLabel")}
        >
          {/* Grip icon with subtle animation */}
          <div className={`
            transition-transform duration-200
            ${isDragging ? "scale-110" : ""}
          `}>
            <GripVertical
              className={`w-5 h-5 ${isDragging ? "text-white" : ""}`}
              strokeWidth={2.5}
            />
          </div>

          {/* Visual hint text - only on larger screens */}
          <span className={`
            hidden sm:block text-[10px] font-medium uppercase tracking-wider
            ${isDragging ? "text-white/80" : "text-slate-400"}
          `}>
            {t("hint")}
          </span>
        </div>

        {/* Activity Card Content */}
        <div className="flex-1 min-w-0">
          <EditableActivityCard activity={activity} {...props} />
        </div>
      </div>

      {/* Drag active overlay glow - iOS style */}
      {isDragging && (
        <div
          className="absolute inset-0 rounded-xl pointer-events-none"
          style={{
            background: "radial-gradient(ellipse at center, rgba(10, 75, 115, 0.08) 0%, transparent 70%)",
          }}
        />
      )}

      {/* Drop zone indicator when other cards are sorting */}
      {isSorting && !isDragging && (
        <div
          className="absolute inset-0 rounded-xl border-2 border-dashed border-[var(--primary)]/30 pointer-events-none"
        />
      )}
    </div>
  );
}

// Memoize to prevent re-renders when sibling cards update during drag operations
// Compares activity by id and key properties that affect rendering
export default memo(SortableActivityCard, (prevProps, nextProps) => {
  // Quick equality check on activity id and index
  if (prevProps.activity.id !== nextProps.activity.id) return false;
  if (prevProps.index !== nextProps.index) return false;
  if (prevProps.isEditMode !== nextProps.isEditMode) return false;
  if (prevProps.isRegenerating !== nextProps.isRegenerating) return false;
  if (prevProps.currentDayIndex !== nextProps.currentDayIndex) return false;

  // Check key activity properties that affect visual rendering
  const prev = prevProps.activity;
  const next = nextProps.activity;
  if (prev.name !== next.name) return false;
  if (prev.start_time !== next.start_time) return false;
  if (prev.duration_minutes !== next.duration_minutes) return false;
  if (prev.image_url !== next.image_url) return false;

  // Voting props
  if (prevProps.votingEnabled !== nextProps.votingEnabled) return false;
  if (prevProps.currentUserVote !== nextProps.currentUserVote) return false;
  if (prevProps.activityStatus !== nextProps.activityStatus) return false;
  if (prevProps.votes?.length !== nextProps.votes?.length) return false;
  if (prevProps.totalVoters !== nextProps.totalVoters) return false;

  return true;
});
