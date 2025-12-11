"use client";

import { useState, useCallback, useEffect, useRef } from "react";

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
  resetToStart: () => void;
}

export function useTourNavigation(
  autoAdvance: boolean = true,
  isOpen: boolean = true // Only auto-advance when tour is visible
): UseTourNavigationReturn {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [direction, setDirection] = useState(0);
  const [hasCompletedTour, setHasCompletedTour] = useState(false);
  const autoAdvanceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Check if tour was previously completed
  useEffect(() => {
    if (typeof window !== "undefined") {
      const completed = localStorage.getItem(TOUR_COMPLETED_KEY) === "true";
      setHasCompletedTour(completed);
    }
  }, []);

  // Reset to slide 0 when tour opens
  useEffect(() => {
    if (isOpen) {
      setCurrentSlide(0);
      setDirection(0);
    }
  }, [isOpen]);

  // Auto-advance timer - ONLY runs when isOpen is true
  useEffect(() => {
    // Clear any existing timer
    if (autoAdvanceTimerRef.current) {
      clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }

    // Only start timer if tour is open and auto-advance is enabled
    if (!isOpen || !autoAdvance || currentSlide >= TOTAL_SLIDES - 1) {
      return;
    }

    autoAdvanceTimerRef.current = setTimeout(() => {
      setDirection(1);
      setCurrentSlide((prev) => Math.min(prev + 1, TOTAL_SLIDES - 1));
    }, AUTO_ADVANCE_DELAY);

    return () => {
      if (autoAdvanceTimerRef.current) {
        clearTimeout(autoAdvanceTimerRef.current);
        autoAdvanceTimerRef.current = null;
      }
    };
  }, [currentSlide, autoAdvance, isOpen]);

  const resetAutoAdvance = useCallback(() => {
    if (autoAdvanceTimerRef.current) {
      clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
  }, []);

  const resetToStart = useCallback(() => {
    resetAutoAdvance();
    setCurrentSlide(0);
    setDirection(0);
  }, [resetAutoAdvance]);

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
    resetToStart,
  };
}

export default useTourNavigation;
