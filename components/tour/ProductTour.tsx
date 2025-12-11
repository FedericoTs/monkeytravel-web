"use client";

import { useEffect, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence, useDragControls } from "framer-motion";
import { useRouter } from "next/navigation";

import TourBackground from "./TourBackground";
import TourProgress from "./TourProgress";
import { useTourNavigation } from "./hooks/useTourNavigation";
import { useReducedMotion } from "./hooks/useReducedMotion";
import { slideVariants, PREMIUM_EASE } from "./animations";

// Import slides
import SlideDestination from "./slides/SlideDestination";
import SlideItinerary from "./slides/SlideItinerary";
import SlideMap from "./slides/SlideMap";
import SlideTemplates from "./slides/SlideTemplates";
import SlideCTA from "./slides/SlideCTA";

// Regular slides without props
const CONTENT_SLIDES = [
  { id: "destination", Component: SlideDestination },
  { id: "itinerary", Component: SlideItinerary },
  { id: "map", Component: SlideMap },
  { id: "templates", Component: SlideTemplates },
];

// Total slides including CTA
const TOTAL_SLIDES = CONTENT_SLIDES.length + 1; // +1 for CTA slide

interface ProductTourProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ProductTour({ isOpen, onClose }: ProductTourProps) {
  const router = useRouter();
  const prefersReducedMotion = useReducedMotion();
  const dragControls = useDragControls();
  const [isMounted, setIsMounted] = useState(false);

  const {
    currentSlide,
    direction,
    isLastSlide,
    goToSlide,
    nextSlide,
    prevSlide,
    completeTour,
    resetAutoAdvance,
  } = useTourNavigation(true);

  // Mount check for portal
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Prevent body scroll when tour is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowRight":
        case " ": // Space
          e.preventDefault();
          nextSlide();
          break;
        case "ArrowLeft":
          e.preventDefault();
          prevSlide();
          break;
        case "Escape":
          handleSkip();
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, nextSlide, prevSlide]);

  // Swipe handling for mobile
  const handleDragEnd = (_: unknown, info: { offset: { x: number }; velocity: { x: number } }) => {
    const swipeThreshold = 50;
    const velocityThreshold = 500;

    if (info.offset.x < -swipeThreshold || info.velocity.x < -velocityThreshold) {
      nextSlide();
    } else if (info.offset.x > swipeThreshold || info.velocity.x > velocityThreshold) {
      prevSlide();
    }
  };

  // Handle skip/close
  const handleSkip = useCallback(() => {
    completeTour();
    onClose();
  }, [completeTour, onClose]);

  // Handle start planning (goes to auth/signup - user must authenticate first)
  const handleStartPlanning = useCallback(() => {
    completeTour();
    onClose();
    router.push("/auth/signup");
  }, [completeTour, onClose, router]);

  // Handle sign in
  const handleSignIn = useCallback(() => {
    completeTour();
    onClose();
    router.push("/auth/login");
  }, [completeTour, onClose, router]);

  // Click navigation zones (left/right thirds on desktop)
  const handleContainerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only on desktop and if clicking directly on the container
    if (window.innerWidth < 1024) return;
    if (e.target !== e.currentTarget) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const thirdWidth = rect.width / 3;

    if (clickX < thirdWidth) {
      prevSlide();
    } else if (clickX > thirdWidth * 2) {
      nextSlide();
    }
  };

  if (!isMounted) return null;

  const content = (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3, ease: PREMIUM_EASE }}
          className="fixed inset-0 z-[200] bg-black"
        >
          {/* Background with Ken Burns */}
          <TourBackground slideIndex={currentSlide} />

          {/* Navigation zones indicator (desktop only) */}
          <div className="hidden lg:block">
            {/* Left zone */}
            <div
              className="absolute left-0 top-0 bottom-0 w-1/6 cursor-w-resize z-30"
              onClick={prevSlide}
            />
            {/* Right zone */}
            <div
              className="absolute right-0 top-0 bottom-0 w-1/6 cursor-e-resize z-30"
              onClick={nextSlide}
            />
          </div>

          {/* Main content area */}
          <motion.div
            className="relative z-10 w-full h-full"
            drag={prefersReducedMotion ? false : "x"}
            dragControls={dragControls}
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.2}
            onDragEnd={handleDragEnd}
            onClick={handleContainerClick}
            style={{ touchAction: "pan-y pinch-zoom" }}
          >
            {/* Slide content */}
            <AnimatePresence mode="wait" custom={direction}>
              <motion.div
                key={currentSlide}
                custom={direction}
                variants={prefersReducedMotion ? undefined : slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                className="absolute inset-0 pt-16 pb-24 md:pt-20 md:pb-28"
              >
{(() => {
                  // Last slide is CTA
                  if (currentSlide === TOTAL_SLIDES - 1) {
                    return (
                      <SlideCTA
                        onStartPlanning={handleStartPlanning}
                        onSignIn={handleSignIn}
                      />
                    );
                  }
                  // Content slides
                  const CurrentSlide = CONTENT_SLIDES[currentSlide].Component;
                  return <CurrentSlide />;
                })()}
              </motion.div>
            </AnimatePresence>

            {/* Navigation arrows (desktop) */}
            <div className="hidden lg:flex absolute top-1/2 -translate-y-1/2 left-4 right-4 justify-between pointer-events-none z-40">
              <motion.button
                onClick={(e) => {
                  e.stopPropagation();
                  prevSlide();
                }}
                disabled={currentSlide === 0}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
                className={`
                  w-12 h-12 rounded-full flex items-center justify-center
                  bg-white/10 backdrop-blur-sm border border-white/20
                  text-white transition-all pointer-events-auto
                  ${currentSlide === 0 ? "opacity-30 cursor-not-allowed" : "hover:bg-white/20"}
                `}
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </motion.button>

              {!isLastSlide && (
                <motion.button
                  onClick={(e) => {
                    e.stopPropagation();
                    nextSlide();
                  }}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                  className="
                    w-12 h-12 rounded-full flex items-center justify-center
                    bg-white/10 backdrop-blur-sm border border-white/20
                    text-white hover:bg-white/20 transition-all pointer-events-auto
                  "
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </motion.button>
              )}
            </div>
          </motion.div>

          {/* Progress & Skip - Fixed at bottom */}
          <div className="fixed bottom-0 left-0 right-0 z-50 px-4 pb-6 md:px-8 md:pb-8 safe-area-bottom">
            <TourProgress
              currentSlide={currentSlide}
              totalSlides={TOTAL_SLIDES}
              onDotClick={goToSlide}
              onSkip={handleSkip}
            />
          </div>

          {/* MonkeyTravel Logo - Top left */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, ease: PREMIUM_EASE }}
            className="fixed top-4 left-4 md:top-6 md:left-6 z-50"
          >
            <div className="flex items-center gap-2">
              <span className="text-2xl">🐒</span>
              <span className="text-white font-semibold text-lg hidden sm:inline">
                MonkeyTravel
              </span>
            </div>
          </motion.div>

          {/* Close button - Top right */}
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3 }}
            onClick={handleSkip}
            className="
              fixed top-4 right-4 md:top-6 md:right-6 z-50
              w-10 h-10 rounded-full
              bg-white/10 backdrop-blur-sm border border-white/20
              text-white hover:bg-white/20
              flex items-center justify-center
              transition-colors
            "
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            aria-label="Close tour"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </motion.button>

          {/* Mobile swipe hint (first slide only) */}
          {currentSlide === 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ delay: 2 }}
              className="lg:hidden fixed bottom-20 left-1/2 -translate-x-1/2 z-40"
            >
              <motion.div
                animate={{ x: [-10, 10, -10] }}
                transition={{ duration: 1.5, repeat: 3, ease: "easeInOut" }}
                className="flex items-center gap-2 text-white/60 text-sm"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                <span>Swipe to explore</span>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </motion.div>
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );

  return createPortal(content, document.body);
}
