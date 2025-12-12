"use client";

import { motion } from "framer-motion";
import { useMemo } from "react";
import { useReducedMotion } from "./hooks/useReducedMotion";

// Aurora orb configuration - soft gradient blobs that drift
interface AuroraOrb {
  id: string;
  color: string;
  size: number; // vw units
  x: string;
  y: string;
  driftX: [string, string];
  driftY: [string, string];
  scale: [number, number];
  duration: number;
  blur: number;
  opacity: number;
}

// iOS-style drifting orbs using brand colors
const AURORA_ORBS: AuroraOrb[] = [
  // Large coral - top left, drifts right-down
  {
    id: "coral-main",
    color: "rgba(255, 107, 107, 0.35)",
    size: 55,
    x: "-5%",
    y: "-15%",
    driftX: ["-5%", "8%"],
    driftY: ["-15%", "-5%"],
    scale: [1, 1.15],
    duration: 20,
    blur: 80,
    opacity: 0.6,
  },
  // Teal accent - center right, drifts up-left
  {
    id: "teal-pulse",
    color: "rgba(0, 180, 166, 0.3)",
    size: 45,
    x: "55%",
    y: "15%",
    driftX: ["55%", "48%"],
    driftY: ["15%", "5%"],
    scale: [1, 1.2],
    duration: 25,
    blur: 70,
    opacity: 0.5,
  },
  // Gold shimmer - bottom center, subtle pulse
  {
    id: "gold-shimmer",
    color: "rgba(255, 217, 61, 0.25)",
    size: 40,
    x: "25%",
    y: "60%",
    driftX: ["25%", "35%"],
    driftY: ["60%", "55%"],
    scale: [1, 1.25],
    duration: 18,
    blur: 60,
    opacity: 0.4,
  },
  // Secondary coral - bottom right
  {
    id: "coral-secondary",
    color: "rgba(255, 107, 107, 0.2)",
    size: 50,
    x: "70%",
    y: "70%",
    driftX: ["70%", "60%"],
    driftY: ["70%", "65%"],
    scale: [1, 1.1],
    duration: 28,
    blur: 90,
    opacity: 0.35,
  },
  // Purple mist - left side, adds depth
  {
    id: "purple-mist",
    color: "rgba(162, 155, 254, 0.18)",
    size: 35,
    x: "5%",
    y: "45%",
    driftX: ["5%", "15%"],
    driftY: ["45%", "38%"],
    scale: [1, 1.18],
    duration: 22,
    blur: 65,
    opacity: 0.3,
  },
  // Small teal accent - top right
  {
    id: "teal-accent",
    color: "rgba(0, 206, 201, 0.2)",
    size: 25,
    x: "80%",
    y: "5%",
    driftX: ["80%", "75%"],
    driftY: ["5%", "12%"],
    scale: [1, 1.3],
    duration: 15,
    blur: 50,
    opacity: 0.35,
  },
];

// Concentric ring ripples for iOS effect
interface RippleRing {
  delay: number;
  duration: number;
}

const RIPPLE_RINGS: RippleRing[] = [
  { delay: 0, duration: 12 },
  { delay: 4, duration: 12 },
  { delay: 8, duration: 12 },
];

interface TourAuroraBackgroundProps {
  slideIndex: number;
  className?: string;
}

export default function TourAuroraBackground({
  slideIndex,
  className = "",
}: TourAuroraBackgroundProps) {
  const prefersReducedMotion = useReducedMotion();

  // Shift orb positions slightly based on slide for subtle parallax
  const orbShift = useMemo(() => {
    return {
      x: slideIndex * 3,
      y: slideIndex * 2,
    };
  }, [slideIndex]);

  // Color intensity shifts per slide
  const slideColorShift = useMemo(() => {
    const shifts = [
      { hue: 0, saturation: 1 },      // Slide 0: Normal
      { hue: -10, saturation: 1.1 },  // Slide 1: Slightly warmer
      { hue: 10, saturation: 0.95 },  // Slide 2: Slightly cooler
      { hue: -5, saturation: 1.05 },  // Slide 3: Warm again
      { hue: 0, saturation: 1.15 },   // Slide 4: More vibrant
    ];
    return shifts[slideIndex] || shifts[0];
  }, [slideIndex]);

  return (
    <div
      className={`absolute inset-0 overflow-hidden ${className}`}
      style={{
        background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f0f23 100%)",
      }}
    >
      {/* Base gradient layer */}
      <div
        className="absolute inset-0"
        style={{
          background: `
            radial-gradient(ellipse 80% 50% at 50% 0%, rgba(255, 107, 107, 0.08) 0%, transparent 50%),
            radial-gradient(ellipse 60% 40% at 100% 100%, rgba(0, 180, 166, 0.06) 0%, transparent 50%),
            radial-gradient(ellipse 50% 50% at 0% 50%, rgba(255, 217, 61, 0.04) 0%, transparent 50%)
          `,
        }}
      />

      {/* Animated Aurora Orbs */}
      {AURORA_ORBS.map((orb) => (
        <motion.div
          key={orb.id}
          className="absolute rounded-full pointer-events-none"
          style={{
            width: `${orb.size}vw`,
            height: `${orb.size}vw`,
            background: `radial-gradient(circle at 30% 30%, ${orb.color}, transparent 70%)`,
            filter: `blur(${orb.blur}px)`,
            opacity: orb.opacity,
            left: orb.x,
            top: orb.y,
            willChange: "transform",
          }}
          animate={
            prefersReducedMotion
              ? {}
              : {
                  x: [
                    `calc(${orb.driftX[0]} + ${orbShift.x}%)`,
                    `calc(${orb.driftX[1]} + ${orbShift.x}%)`,
                    `calc(${orb.driftX[0]} + ${orbShift.x}%)`,
                  ],
                  y: [
                    `calc(${orb.driftY[0]} + ${orbShift.y}%)`,
                    `calc(${orb.driftY[1]} + ${orbShift.y}%)`,
                    `calc(${orb.driftY[0]} + ${orbShift.y}%)`,
                  ],
                  scale: [orb.scale[0], orb.scale[1], orb.scale[0]],
                }
          }
          transition={{
            duration: orb.duration,
            ease: "easeInOut",
            repeat: Infinity,
            repeatType: "loop",
          }}
        />
      ))}

      {/* Concentric Ripple Rings - iOS style */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        {!prefersReducedMotion &&
          RIPPLE_RINGS.map((ring, index) => (
            <motion.div
              key={`ripple-${index}`}
              className="absolute rounded-full border border-white/[0.03]"
              style={{
                width: "10vw",
                height: "10vw",
              }}
              animate={{
                width: ["10vw", "150vw"],
                height: ["10vw", "150vw"],
                opacity: [0.15, 0],
              }}
              transition={{
                duration: ring.duration,
                delay: ring.delay,
                ease: "easeOut",
                repeat: Infinity,
                repeatDelay: 0,
              }}
            />
          ))}
      </div>

      {/* Subtle noise texture overlay */}
      <div
        className="absolute inset-0 opacity-[0.015] pointer-events-none"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
        }}
      />

      {/* Vignette effect for depth */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `
            radial-gradient(ellipse 100% 100% at 50% 50%, transparent 30%, rgba(0, 0, 0, 0.4) 100%)
          `,
        }}
      />

      {/* Slide-specific accent glow */}
      <motion.div
        className="absolute inset-0 pointer-events-none"
        animate={{
          opacity: [0.3, 0.5, 0.3],
        }}
        transition={{
          duration: 4,
          ease: "easeInOut",
          repeat: Infinity,
        }}
        style={{
          background: getSlideAccentGradient(slideIndex),
        }}
      />
    </div>
  );
}

// Get slide-specific accent gradient
function getSlideAccentGradient(slideIndex: number): string {
  const gradients = [
    // Slide 0: Destination - Coral emphasis
    "radial-gradient(ellipse 60% 40% at 20% 20%, rgba(255, 107, 107, 0.1) 0%, transparent 60%)",
    // Slide 1: Itinerary - Teal emphasis
    "radial-gradient(ellipse 60% 40% at 80% 30%, rgba(0, 180, 166, 0.1) 0%, transparent 60%)",
    // Slide 2: Map - Gold emphasis
    "radial-gradient(ellipse 60% 40% at 50% 50%, rgba(255, 217, 61, 0.08) 0%, transparent 60%)",
    // Slide 3: Templates - Purple accent
    "radial-gradient(ellipse 60% 40% at 30% 70%, rgba(162, 155, 254, 0.1) 0%, transparent 60%)",
    // Slide 4: CTA - Multi-color vibrant
    `radial-gradient(ellipse 50% 30% at 20% 50%, rgba(255, 107, 107, 0.12) 0%, transparent 50%),
     radial-gradient(ellipse 50% 30% at 80% 50%, rgba(0, 180, 166, 0.1) 0%, transparent 50%),
     radial-gradient(ellipse 40% 30% at 50% 80%, rgba(255, 217, 61, 0.1) 0%, transparent 50%)`,
  ];
  return gradients[slideIndex] || gradients[0];
}
