"use client";

import { useState, useEffect, useCallback, useMemo } from "react";

interface GenerationProgressProps {
  destination: string;
  isGenerating: boolean;
  onComplete?: () => void;
}

// Generation phases with timing weights
const PHASES = [
  {
    id: "research",
    label: "Researching",
    description: "Discovering the best of",
    icon: "globe",
    weight: 20, // 0-20%
    duration: 4000, // Target duration in ms
  },
  {
    id: "planning",
    label: "Planning activities",
    description: "Curating experiences for",
    icon: "calendar",
    weight: 30, // 20-50%
    duration: 8000,
  },
  {
    id: "optimizing",
    label: "Optimizing schedule",
    description: "Creating the perfect flow for",
    icon: "route",
    weight: 30, // 50-80%
    duration: 12000,
  },
  {
    id: "enriching",
    label: "Adding details",
    description: "Enriching with local insights for",
    icon: "sparkle",
    weight: 15, // 80-95%
    duration: 15000, // This phase stretches until API responds
  },
  {
    id: "finalizing",
    label: "Finalizing",
    description: "Putting finishing touches on",
    icon: "check",
    weight: 5, // 95-100%
    duration: 1000,
  },
];

// Fun facts shown during loading
const DESTINATION_FACTS: Record<string, string[]> = {
  default: [
    "AI is analyzing thousands of reviews and ratings",
    "Finding hidden gems that locals love",
    "Optimizing routes to save you time",
    "Checking opening hours and seasonal availability",
    "Balancing activities with rest time",
    "Matching experiences to your travel style",
  ],
};

// Animated icons for each phase
function PhaseIcon({ phase, isActive }: { phase: string; isActive: boolean }) {
  const baseClass = `w-6 h-6 transition-all duration-500 ${
    isActive ? "text-[var(--primary)] scale-110" : "text-slate-300"
  }`;

  switch (phase) {
    case "globe":
      return (
        <svg className={`${baseClass} ${isActive ? "animate-spin-slow" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    case "calendar":
      return (
        <svg className={`${baseClass} ${isActive ? "animate-pulse" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      );
    case "route":
      return (
        <svg className={`${baseClass} ${isActive ? "animate-bounce-subtle" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
        </svg>
      );
    case "sparkle":
      return (
        <svg className={`${baseClass} ${isActive ? "animate-sparkle" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
        </svg>
      );
    case "check":
      return (
        <svg className={`${baseClass} ${isActive ? "animate-scale-in" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    default:
      return null;
  }
}

// Animated background orbs
function FloatingOrbs() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-[var(--primary)]/10 rounded-full blur-3xl animate-float-slow" />
      <div className="absolute bottom-1/4 right-1/4 w-48 h-48 bg-[var(--accent)]/20 rounded-full blur-3xl animate-float-slow-reverse" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-gradient-to-br from-[var(--primary)]/5 to-[var(--accent)]/5 rounded-full blur-3xl animate-pulse-slow" />
    </div>
  );
}

// Animated plane that travels across (left to right)
function TravelingPlane({ progress }: { progress: number }) {
  return (
    <div
      className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 transition-all duration-1000 ease-out z-10"
      style={{ left: `${Math.min(progress, 95)}%` }}
    >
      <div className="relative">
        {/* Trail effect - behind the plane (to the left), fading away from plane */}
        <div className="absolute right-full top-1/2 -translate-y-1/2 w-20 h-0.5 bg-gradient-to-l from-[var(--primary)]/60 to-transparent" />
        {/* Plane - rotated 135deg (90 + 45) to point right with slight downward tilt */}
        <svg
          className="w-7 h-7 text-[var(--primary)] rotate-[135deg] drop-shadow-lg animate-plane-bob"
          fill="currentColor"
          viewBox="0 0 24 24"
        >
          <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" />
        </svg>
      </div>
    </div>
  );
}

export default function GenerationProgress({
  destination,
  isGenerating,
}: GenerationProgressProps) {
  const [progress, setProgress] = useState(0);
  const [currentPhaseIndex, setCurrentPhaseIndex] = useState(0);
  const [factIndex, setFactIndex] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0);

  // Get current phase based on progress
  const currentPhase = useMemo(() => {
    let cumulative = 0;
    for (let i = 0; i < PHASES.length; i++) {
      cumulative += PHASES[i].weight;
      if (progress < cumulative) {
        return { phase: PHASES[i], index: i };
      }
    }
    return { phase: PHASES[PHASES.length - 1], index: PHASES.length - 1 };
  }, [progress]);

  // Update phase index for animation triggers
  useEffect(() => {
    if (currentPhase.index !== currentPhaseIndex) {
      setCurrentPhaseIndex(currentPhase.index);
    }
  }, [currentPhase.index, currentPhaseIndex]);

  // Smart progress animation - exponential slowdown approaching each threshold
  useEffect(() => {
    if (!isGenerating) {
      setProgress(0);
      setElapsedTime(0);
      return;
    }

    const startTime = Date.now();
    let animationFrame: number;

    const updateProgress = () => {
      const elapsed = Date.now() - startTime;
      setElapsedTime(elapsed);

      // Calculate target progress with exponential decay
      // Fast at start, progressively slower
      // Never exceeds 95% until API responds
      const maxProgress = 95;
      const timeConstant = 25000; // How quickly we approach max (higher = slower)

      // Exponential approach: progress = max * (1 - e^(-t/tau))
      const calculatedProgress = maxProgress * (1 - Math.exp(-elapsed / timeConstant));

      // Add small oscillation to prevent "stuck" feeling
      const oscillation = Math.sin(elapsed / 500) * 0.3;

      setProgress(Math.min(calculatedProgress + oscillation, maxProgress));

      animationFrame = requestAnimationFrame(updateProgress);
    };

    animationFrame = requestAnimationFrame(updateProgress);

    return () => {
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
      }
    };
  }, [isGenerating]);

  // Rotate through facts
  useEffect(() => {
    if (!isGenerating) return;

    const facts = DESTINATION_FACTS.default;
    const interval = setInterval(() => {
      setFactIndex((prev) => (prev + 1) % facts.length);
    }, 4000);

    return () => clearInterval(interval);
  }, [isGenerating]);

  // Format elapsed time
  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    return `${seconds}s`;
  };

  const facts = DESTINATION_FACTS.default;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 flex items-center justify-center relative overflow-hidden">
      <FloatingOrbs />

      <div className="relative z-10 w-full max-w-lg mx-auto px-6">
        {/* Main content card */}
        <div className="bg-white/80 backdrop-blur-xl rounded-3xl shadow-2xl shadow-slate-200/50 border border-white/50 p-8 sm:p-10">
          {/* Animated destination badge */}
          <div className="flex justify-center mb-8">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-[var(--primary)]/10 to-[var(--accent)]/10 rounded-full border border-[var(--primary)]/20">
              <span className="w-2 h-2 bg-[var(--primary)] rounded-full animate-pulse" />
              <span className="text-sm font-medium text-[var(--primary)]">
                {destination}
              </span>
            </div>
          </div>

          {/* Phase indicator with icons */}
          <div className="flex justify-between items-center mb-8 px-2">
            {PHASES.slice(0, 4).map((phase, idx) => (
              <div key={phase.id} className="flex flex-col items-center gap-2">
                <div className={`
                  w-10 h-10 rounded-full flex items-center justify-center transition-all duration-500
                  ${idx < currentPhaseIndex
                    ? "bg-[var(--primary)] text-white"
                    : idx === currentPhaseIndex
                      ? "bg-[var(--primary)]/10 ring-2 ring-[var(--primary)] ring-offset-2"
                      : "bg-slate-100 text-slate-300"
                  }
                `}>
                  {idx < currentPhaseIndex ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <PhaseIcon phase={phase.icon} isActive={idx === currentPhaseIndex} />
                  )}
                </div>
                <span className={`text-xs font-medium transition-colors ${
                  idx <= currentPhaseIndex ? "text-slate-700" : "text-slate-400"
                }`}>
                  {phase.label.split(" ")[0]}
                </span>
              </div>
            ))}
          </div>

          {/* Current phase description */}
          <div className="text-center mb-8">
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-2 transition-all duration-500">
              {currentPhase.phase.label}...
            </h2>
            <p className="text-slate-600">
              {currentPhase.phase.description}{" "}
              <span className="font-semibold text-[var(--primary)]">{destination}</span>
            </p>
          </div>

          {/* Progress track with plane */}
          <div className="relative h-3 bg-slate-100 rounded-full overflow-visible mb-6">
            {/* Progress fill with gradient */}
            <div
              className="absolute inset-y-0 left-0 bg-gradient-to-r from-[var(--primary)] via-[var(--primary)] to-[var(--accent)] rounded-full transition-all duration-300 ease-out"
              style={{ width: `${progress}%` }}
            >
              {/* Shimmer effect */}
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer rounded-full" />
            </div>

            {/* Traveling plane indicator */}
            <TravelingPlane progress={progress} />
          </div>

          {/* Progress percentage and time */}
          <div className="flex justify-between items-center text-sm mb-8">
            <span className="text-slate-500">
              {formatTime(elapsedTime)} elapsed
            </span>
            <span className="font-semibold text-[var(--primary)]">
              {Math.round(progress)}%
            </span>
          </div>

          {/* Rotating fun facts */}
          <div className="bg-slate-50 rounded-2xl p-4 min-h-[60px] flex items-center justify-center">
            <p
              key={factIndex}
              className="text-sm text-slate-600 text-center animate-fade-in-up"
            >
              <span className="text-[var(--accent)] mr-2">✨</span>
              {facts[factIndex]}
            </p>
          </div>
        </div>

        {/* Bottom reassurance */}
        <p className="text-center text-xs text-slate-400 mt-6">
          This usually takes 20-40 seconds for a personalized itinerary
        </p>
      </div>
    </div>
  );
}
