"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslations } from "next-intl";

const STORAGE_KEY = "monkeytravel_collab_onboarding_seen";

const STEPS = [
  { emoji: "🎉", key: "welcome" },
  { emoji: "🗳️", key: "voting" },
  { emoji: "💡", key: "proposing" },
  { emoji: "🔗", key: "sharing" },
] as const;

interface CollaboratorOnboardingProps {
  isOwner: boolean;
}

export default function CollaboratorOnboarding({ isOwner }: CollaboratorOnboardingProps) {
  const t = useTranslations("common.collaborationOnboarding");
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (isOwner) return;
    if (typeof window === "undefined") return;

    const seen = localStorage.getItem(STORAGE_KEY) === "true";
    if (!seen) {
      // Small delay so the page renders first
      const timer = setTimeout(() => setIsOpen(true), 800);
      return () => clearTimeout(timer);
    }
  }, [isOwner]);

  const handleClose = () => {
    setIsOpen(false);
    localStorage.setItem(STORAGE_KEY, "true");
  };

  const handleNext = () => {
    if (step < STEPS.length - 1) {
      setStep(step + 1);
    } else {
      handleClose();
    }
  };

  const handleBack = () => {
    if (step > 0) setStep(step - 1);
  };

  if (!isOpen) return null;

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
            className="fixed inset-0 bg-black/50 z-50"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-50 max-w-sm mx-auto"
          >
            <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
              {/* Progress dots */}
              <div className="flex justify-center gap-1.5 pt-5">
                {STEPS.map((_, i) => (
                  <div
                    key={i}
                    className={`h-1.5 rounded-full transition-all duration-300 ${
                      i === step
                        ? "w-6 bg-[var(--primary)]"
                        : i < step
                          ? "w-1.5 bg-[var(--primary)]/40"
                          : "w-1.5 bg-gray-200"
                    }`}
                  />
                ))}
              </div>

              {/* Content */}
              <AnimatePresence mode="wait">
                <motion.div
                  key={step}
                  initial={{ opacity: 0, x: 30 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -30 }}
                  transition={{ duration: 0.2 }}
                  className="px-6 py-6 text-center"
                >
                  <span className="text-5xl block mb-4">{current.emoji}</span>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">
                    {t(`${current.key}.title`)}
                  </h3>
                  <p className="text-sm text-gray-600 leading-relaxed">
                    {t(`${current.key}.description`)}
                  </p>
                </motion.div>
              </AnimatePresence>

              {/* Actions */}
              <div className="px-6 pb-5 flex items-center gap-3">
                {step > 0 ? (
                  <button
                    onClick={handleBack}
                    className="flex-1 py-2.5 text-sm font-medium text-gray-600 bg-gray-100
                               rounded-xl hover:bg-gray-200 transition-colors"
                  >
                    {t("back")}
                  </button>
                ) : (
                  <button
                    onClick={handleClose}
                    className="flex-1 py-2.5 text-sm font-medium text-gray-500
                               hover:text-gray-700 transition-colors"
                  >
                    {t("skip")}
                  </button>
                )}
                <button
                  onClick={handleNext}
                  className="flex-1 py-2.5 text-sm font-semibold text-white bg-[var(--primary)]
                             rounded-xl hover:bg-[var(--primary)]/90 transition-colors"
                >
                  {isLast ? t("getStarted") : t("next")}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
