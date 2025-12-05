"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { QuickTag } from "@/types/timeline";
import BottomSheet from "../ui/BottomSheet";
import StarRating from "../ui/StarRating";

interface ActivityRatingModalProps {
  isOpen: boolean;
  onClose: () => void;
  activityName: string;
  activityImage?: string;
  onSubmit: (data: {
    rating: number;
    notes?: string;
    quickTags?: QuickTag[];
  }) => void;
  initialRating?: number;
}

const QUICK_TAGS: { id: QuickTag; label: string; emoji: string }[] = [
  { id: "must-do", label: "Must-do", emoji: "⭐" },
  { id: "crowded", label: "Crowded", emoji: "👥" },
  { id: "worth-it", label: "Worth it", emoji: "✨" },
  { id: "skip-next-time", label: "Skip next time", emoji: "⏭️" },
  { id: "hidden-gem", label: "Hidden gem", emoji: "💎" },
  { id: "overrated", label: "Overrated", emoji: "😐" },
];

export default function ActivityRatingModal({
  isOpen,
  onClose,
  activityName,
  activityImage,
  onSubmit,
  initialRating = 0,
}: ActivityRatingModalProps) {
  const [rating, setRating] = useState(initialRating);
  const [notes, setNotes] = useState("");
  const [selectedTags, setSelectedTags] = useState<QuickTag[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const toggleTag = (tagId: QuickTag) => {
    setSelectedTags((prev) =>
      prev.includes(tagId)
        ? prev.filter((t) => t !== tagId)
        : [...prev, tagId]
    );
  };

  const handleSubmit = async () => {
    if (rating === 0) return;

    setIsSubmitting(true);
    try {
      await onSubmit({
        rating,
        notes: notes.trim() || undefined,
        quickTags: selectedTags.length > 0 ? selectedTags : undefined,
      });
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSkip = () => {
    onClose();
  };

  // Desktop modal content (used inside BottomSheet on mobile)
  const ModalContent = () => (
    <div className="space-y-6">
      {/* Header with celebration */}
      <div className="text-center">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", duration: 0.5 }}
          className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-100 mb-4"
        >
          <span className="text-3xl">✨</span>
        </motion.div>
        <h2 className="text-xl font-bold text-slate-900 mb-1">
          Activity Complete!
        </h2>
        <p className="text-slate-600">{activityName}</p>
      </div>

      {/* Activity image (if available) */}
      {activityImage && (
        <div className="mx-auto w-32 h-32 rounded-xl overflow-hidden shadow-md">
          <img
            src={activityImage}
            alt={activityName}
            className="w-full h-full object-cover"
          />
        </div>
      )}

      {/* Rating stars */}
      <div className="text-center">
        <p className="text-sm text-slate-500 mb-3">How was it?</p>
        <div className="flex justify-center">
          <StarRating
            value={rating}
            onChange={setRating}
            size="lg"
          />
        </div>
        <p className="text-sm text-slate-400 mt-2">
          {rating === 0 && "Tap to rate"}
          {rating === 1 && "Not great"}
          {rating === 2 && "Could be better"}
          {rating === 3 && "It was okay"}
          {rating === 4 && "Really good!"}
          {rating === 5 && "Amazing!"}
        </p>
      </div>

      {/* Quick tags */}
      <div>
        <p className="text-sm text-slate-500 mb-3 text-center">Quick tags</p>
        <div className="flex flex-wrap justify-center gap-2">
          {QUICK_TAGS.map((tag) => (
            <motion.button
              key={tag.id}
              onClick={() => toggleTag(tag.id)}
              className={`
                inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full
                text-sm font-medium transition-colors
                ${selectedTags.includes(tag.id)
                  ? "bg-[var(--primary)] text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }
              `}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <span>{tag.emoji}</span>
              <span>{tag.label}</span>
            </motion.button>
          ))}
        </div>
      </div>

      {/* Notes textarea */}
      <div>
        <label className="block text-sm text-slate-500 mb-2 text-center">
          Add a quick note (optional)
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Amazing views! Tip: go early to avoid crowds..."
          className="
            w-full px-4 py-3 rounded-xl
            border border-slate-200 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20
            text-slate-900 placeholder:text-slate-400
            resize-none transition-colors
          "
          rows={3}
        />
      </div>

      {/* Action buttons */}
      <div className="space-y-3">
        <button
          onClick={handleSubmit}
          disabled={rating === 0 || isSubmitting}
          className={`
            w-full py-3.5 rounded-xl font-semibold text-white
            transition-all
            ${rating === 0
              ? "bg-slate-300 cursor-not-allowed"
              : "bg-[var(--primary)] hover:bg-[var(--primary)]/90 active:scale-[0.98]"
            }
          `}
        >
          {isSubmitting ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Saving...
            </span>
          ) : (
            "Continue"
          )}
        </button>

        <button
          onClick={handleSkip}
          className="
            w-full py-2 text-sm text-slate-500 hover:text-slate-700
            transition-colors
          "
        >
          Skip for now
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile: Bottom Sheet */}
      <div className="sm:hidden">
        <BottomSheet
          isOpen={isOpen}
          onClose={onClose}
          title="Rate Activity"
          showCloseButton
        >
          <ModalContent />
        </BottomSheet>
      </div>

      {/* Desktop: Centered Modal */}
      <AnimatePresence>
        {isOpen && (
          <div className="hidden sm:block">
            <motion.div
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {/* Backdrop */}
              <motion.div
                className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={onClose}
              />

              {/* Modal */}
              <motion.div
                className="relative w-full max-w-md bg-white rounded-2xl shadow-xl p-6"
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                transition={{ type: "spring", duration: 0.4 }}
              >
                {/* Close button */}
                <button
                  onClick={onClose}
                  className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>

                <ModalContent />
              </motion.div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
