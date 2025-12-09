"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import type { Activity } from "@/types";
import EditableActivityCard from "./EditableActivityCard";

interface SortableActivityCardProps {
  activity: Activity;
  index: number;
  currency?: string;
  showGallery?: boolean;
  isEditMode: boolean;
  onMove: (direction: "up" | "down") => void;
  onDelete: () => void;
  onUpdate: (updates: Partial<Activity>) => void;
  onMoveToDay: (dayIndex: number) => void;
  onRegenerate: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  availableDays: number[];
  currentDayIndex: number;
  isRegenerating?: boolean;
  disableAutoFetch?: boolean;
  onPhotoCapture?: (activityId: string, photoUrl: string) => void;
}

export default function SortableActivityCard({
  activity,
  ...props
}: SortableActivityCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: activity.id || `activity-${props.index}`,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: transition || "transform 200ms ease",
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative group ${
        isDragging
          ? "shadow-2xl ring-2 ring-[var(--primary)] rounded-xl scale-[1.02]"
          : ""
      }`}
    >
      {/* Drag Handle - visible on hover in edit mode */}
      <div
        {...attributes}
        {...listeners}
        className={`absolute left-0 top-1/2 -translate-y-1/2 -translate-x-full pr-2 transition-opacity cursor-grab active:cursor-grabbing z-10 touch-none ${
          isDragging ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        }`}
        title="Drag to reorder"
        aria-label="Drag handle"
      >
        <div className={`p-1.5 rounded-lg border shadow-sm transition-all ${
          isDragging
            ? "bg-[var(--primary)] border-[var(--primary)] text-white"
            : "bg-white border-slate-200 hover:bg-slate-50 hover:border-slate-300"
        }`}>
          <GripVertical className={`w-4 h-4 ${isDragging ? "text-white" : "text-slate-400"}`} />
        </div>
      </div>

      {/* Activity Card */}
      <EditableActivityCard activity={activity} {...props} />
    </div>
  );
}
