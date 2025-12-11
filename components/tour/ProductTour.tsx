"use client";

import { useEffect, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence, useDragControls } from "framer-motion";
import { useRouter } from "next/navigation";
import Image from "next/image";

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

  // Handle skip - goes directly to signup (skipping the tour)
  const handleSkip = useCallback(() => {
    completeTour();
    onClose();
    router.push("/auth/signup");
  }, [completeTour, onClose, router]);

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
                className="absolute inset-0 pt-12 pb-10 md:pt-16 md:pb-20 overflow-y-auto overflow-x-hidden"
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
            <div className="hidden lg:flex absolute top-1/2 -translate-y-1/2 left-6 right-6 justify-between pointer-events-none z-40">
              <motion.button
                onClick={(e) => {
                  e.stopPropagation();
                  prevSlide();
                }}
                disabled={currentSlide === 0}
                whileHover={{ scale: 1.1, x: -3 }}
                whileTap={{ scale: 0.95 }}
                className={`
                  w-14 h-14 rounded-full flex items-center justify-center
                  bg-[var(--navy)]/40 backdrop-blur-md
                  border border-white/15
                  text-white/80 transition-all duration-300 pointer-events-auto
                  ${currentSlide === 0
                    ? "opacity-30 cursor-not-allowed"
                    : "hover:bg-[var(--primary)]/30 hover:border-[var(--primary)]/40 hover:text-white hover:shadow-lg hover:shadow-[var(--primary)]/20"
                  }
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
                  whileHover={{ scale: 1.1, x: 3 }}
                  whileTap={{ scale: 0.95 }}
                  className="
                    w-14 h-14 rounded-full flex items-center justify-center
                    bg-[var(--navy)]/40 backdrop-blur-md
                    border border-white/15
                    text-white/80 transition-all duration-300 pointer-events-auto
                    hover:bg-[var(--accent)]/40 hover:border-[var(--accent)]/50
                    hover:text-white hover:shadow-lg hover:shadow-[var(--accent)]/20
                  "
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </motion.button>
              )}
            </div>
          </motion.div>

          {/* Progress Dots - Fixed at bottom - iOS ultra-compact */}
          <div className="fixed bottom-0 left-0 right-0 z-50 px-4 pb-3 md:px-8 md:pb-5 safe-area-bottom">
            <TourProgress
              currentSlide={currentSlide}
              totalSlides={TOTAL_SLIDES}
              onDotClick={goToSlide}
            />
          </div>

          {/* MonkeyTravel Logo - Top left - Clean minimal style */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, ease: PREMIUM_EASE }}
            className="fixed top-4 left-4 md:top-6 md:left-6 z-50"
          >
            <div className="flex items-center gap-2">
              <Image
                src="/images/logo.png"
                alt="MonkeyTravel"
                width={32}
                height={32}
                className="w-8 h-8 drop-shadow-lg"
              />
              <span
                className="text-white text-base font-semibold tracking-tight hidden sm:inline drop-shadow-md"
                style={{ fontFamily: "var(--font-playfair), Georgia, serif" }}
              >
                MonkeyTravel
              </span>
            </div>
          </motion.div>

          {/* Skip button - Top right */}
          <motion.button
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3, ease: PREMIUM_EASE }}
            onClick={handleSkip}
            className="
              fixed top-4 right-4 md:top-6 md:right-6 z-50
              flex items-center gap-1
              text-white/60 hover:text-white/90
              text-xs md:text-sm font-medium
              transition-all duration-200
              px-2.5 py-1.5 md:px-3 md:py-2
              rounded-full
              hover:bg-white/10
            "
            style={{ fontFamily: "var(--font-source-sans), system-ui, sans-serif" }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            aria-label="Skip tour"
          >
            <span>Skip</span>
            <svg className="w-3 h-3 md:w-3.5 md:h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </motion.button>

          {/* Mobile swipe hint (first slide only) - iOS compact */}
          {currentSlide === 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ delay: 1.5 }}
              className="lg:hidden fixed bottom-8 left-1/2 -translate-x-1/2 z-40"
            >
              <motion.div
                animate={{ x: [-6, 6, -6] }}
                transition={{ duration: 1.5, repeat: 2, ease: "easeInOut" }}
                className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-black/20 backdrop-blur-md"
              >
                <svg className="w-2.5 h-2.5 text-white/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                <span className="text-white/50 text-[10px] font-medium">Swipe</span>
                <svg className="w-2.5 h-2.5 text-white/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
