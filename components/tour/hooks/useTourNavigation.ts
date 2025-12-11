"use client";

import { useState, useCallback, useEffect } from "react";

const TOTAL_SLIDES = 5;
const AUTO_ADVANCE_DELAY = 8000; // 8 seconds per slide
const TOUR_COMPLETED_KEY = "monkeytravel_tour_completed";

interface UseTourNavigationReturn {
  currentSlide: number;
  direction: number;
  isFirstSlide: boolean;
  isLastSlide: boolean;
  progress: number;
  goToSlide: (index: number) => void;
  nextSlide: () => void;
  prevSlide: () => void;
  completeTour: () => void;
  hasCompletedTour: boolean;
  resetAutoAdvance: () => void;
}

export function useTourNavigation(
  autoAdvance: boolean = true
): UseTourNavigationReturn {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [direction, setDirection] = useState(0);
  const [hasCompletedTour, setHasCompletedTour] = useState(false);
  const [autoAdvanceTimer, setAutoAdvanceTimer] = useState<NodeJS.Timeout | null>(null);

  // Check if tour was previously completed
  useEffect(() => {
    if (typeof window !== "undefined") {
      const completed = localStorage.getItem(TOUR_COMPLETED_KEY) === "true";
      setHasCompletedTour(completed);
    }
  }, []);

  // Auto-advance timer
  useEffect(() => {
    if (!autoAdvance || currentSlide >= TOTAL_SLIDES - 1) {
      return;
    }

    const timer = setTimeout(() => {
      nextSlide();
    }, AUTO_ADVANCE_DELAY);

    setAutoAdvanceTimer(timer);

    return () => {
      if (timer) clearTimeout(timer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSlide, autoAdvance]);

  const resetAutoAdvance = useCallback(() => {
    if (autoAdvanceTimer) {
      clearTimeout(autoAdvanceTimer);
    }
  }, [autoAdvanceTimer]);

  const goToSlide = useCallback((index: number) => {
    resetAutoAdvance();
    const clampedIndex = Math.max(0, Math.min(TOTAL_SLIDES - 1, index));
    setDirection(clampedIndex > currentSlide ? 1 : -1);
    setCurrentSlide(clampedIndex);
  }, [currentSlide, resetAutoAdvance]);

  const nextSlide = useCallback(() => {
    if (currentSlide < TOTAL_SLIDES - 1) {
      setDirection(1);
      setCurrentSlide((prev) => prev + 1);
    }
  }, [currentSlide]);

  const prevSlide = useCallback(() => {
    resetAutoAdvance();
    if (currentSlide > 0) {
      setDirection(-1);
      setCurrentSlide((prev) => prev - 1);
    }
  }, [currentSlide, resetAutoAdvance]);

  const completeTour = useCallback(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(TOUR_COMPLETED_KEY, "true");
      setHasCompletedTour(true);
    }
  }, []);

  return {
    currentSlide,
    direction,
    isFirstSlide: currentSlide === 0,
    isLastSlide: currentSlide === TOTAL_SLIDES - 1,
    progress: (currentSlide + 1) / TOTAL_SLIDES,
    goToSlide,
    nextSlide,
    prevSlide,
    completeTour,
    hasCompletedTour,
    resetAutoAdvance,
  };
}

export default useTourNavigation;
