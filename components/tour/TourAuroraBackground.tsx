"use client";

import { motion } from "framer-motion";
import { useMemo } from "react";
import { useReducedMotion } from "./hooks/useReducedMotion";

// Premium coral aurora orbs on pristine white/cream background
interface AuroraOrb {
  id: string;
  color: string;
  size: number;
  x: number;
  y: number;
  blur: number;
  duration: number;
  delay: number;
  opacity: number;
}

const AURORA_ORBS: AuroraOrb[] = [
  // Primary coral glow - large, soft, top-left
  {
    id: "coral-primary",
    color: "rgba(255, 107, 107, 0.18)",
    size: 65,
    x: 15,
    y: 10,
    blur: 120,
    duration: 25,
    delay: 0,
    opacity: 1,
  },
  // Secondary coral - medium, bottom-right
  {
    id: "coral-secondary",
    color: "rgba(255, 107, 107, 0.14)",
    size: 55,
    x: 80,
    y: 75,
    blur: 100,
    duration: 30,
    delay: 2,
    opacity: 1,
  },
  // Teal accent - subtle complement, right side
  {
    id: "teal-accent",
    color: "rgba(0, 180, 166, 0.1)",
    size: 45,
    x: 90,
    y: 25,
    blur: 90,
    duration: 22,
    delay: 4,
    opacity: 1,
  },
  // Gold shimmer - bottom left, very subtle
  {
    id: "gold-shimmer",
    color: "rgba(255, 217, 61, 0.08)",
    size: 40,
    x: 5,
    y: 85,
    blur: 80,
    duration: 28,
    delay: 6,
    opacity: 1,
  },
  // Coral mist - center ambient fill
  {
    id: "coral-mist",
    color: "rgba(255, 180, 180, 0.12)",
    size: 70,
    x: 50,
    y: 45,
    blur: 150,
    duration: 35,
    delay: 3,
    opacity: 1,
  },
  // Peachy warmth - top right
  {
    id: "peach-warmth",
    color: "rgba(255, 200, 150, 0.1)",
    size: 50,
    x: 70,
    y: 5,
    blur: 110,
    duration: 20,
    delay: 5,
    opacity: 1,
  },
];

// Wave animation paths - organic flowing shapes
const WAVE_CONFIGS = [
  {
    id: "wave-1",
    fill: "rgba(255, 107, 107, 0.05)",
    paths: [
      "M0,100 C150,70 350,130 500,100 C650,70 850,130 1000,100 L1000,200 L0,200 Z",
      "M0,85 C200,115 300,65 500,85 C700,105 800,55 1000,85 L1000,200 L0,200 Z",
      "M0,100 C150,70 350,130 500,100 C650,70 850,130 1000,100 L1000,200 L0,200 Z",
    ],
    duration: 12,
  },
  {
    id: "wave-2",
    fill: "rgba(255, 107, 107, 0.035)",
    paths: [
      "M0,120 C200,90 300,150 500,120 C700,90 800,150 1000,120 L1000,200 L0,200 Z",
      "M0,135 C150,105 350,165 500,135 C650,105 850,165 1000,135 L1000,200 L0,200 Z",
      "M0,120 C200,90 300,150 500,120 C700,90 800,150 1000,120 L1000,200 L0,200 Z",
    ],
    duration: 16,
  },
  {
    id: "wave-3",
    fill: "rgba(255, 107, 107, 0.025)",
    paths: [
      "M0,145 C100,120 400,170 500,145 C600,120 900,170 1000,145 L1000,200 L0,200 Z",
      "M0,160 C200,135 300,185 500,160 C700,135 800,185 1000,160 L1000,200 L0,200 Z",
      "M0,145 C100,120 400,170 500,145 C600,120 900,170 1000,145 L1000,200 L0,200 Z",
    ],
    duration: 20,
  },
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

  // Shift aurora positions slightly based on slide for parallax effect
  const orbShift = useMemo(() => ({
    x: slideIndex * 2.5,
    y: slideIndex * 1.5,
  }), [slideIndex]);

  return (
    <div className={`absolute inset-0 overflow-hidden ${className}`}>
      {/* Base: Pristine white to warm cream gradient */}
      <div
        className="absolute inset-0"
        style={{
          background: `
            linear-gradient(180deg,
              #FFFFFF 0%,
              #FFFCFA 20%,
              #FFF9F5 45%,
              #FFFAF5 70%,
              #FFF8F0 100%
            )
          `,
        }}
      />

      {/* Ultra-subtle grid pattern for premium depth */}
      <div
        className="absolute inset-0 opacity-[0.025]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(255, 107, 107, 0.4) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255, 107, 107, 0.4) 1px, transparent 1px)
          `,
          backgroundSize: "80px 80px",
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
            background: `radial-gradient(circle at 35% 35%, ${orb.color} 0%, transparent 65%)`,
            filter: `blur(${orb.blur}px)`,
            left: `${orb.x}%`,
            top: `${orb.y}%`,
            transform: "translate(-50%, -50%)",
            opacity: orb.opacity,
            willChange: "transform, opacity",
          }}
          animate={
            prefersReducedMotion
              ? {}
              : {
                  x: [0, 25, -15, 10, 0],
                  y: [0, -18, 22, -8, 0],
                  scale: [1, 1.08, 0.96, 1.04, 1],
                  opacity: [orb.opacity, orb.opacity * 1.15, orb.opacity * 0.9, orb.opacity * 1.1, orb.opacity],
                }
          }
          transition={{
            duration: orb.duration,
            delay: orb.delay,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      ))}

      {/* Animated Wave Layers - Bottom */}
      <svg
        className="absolute bottom-0 left-0 w-full h-44 md:h-56"
        viewBox="0 0 1000 200"
        preserveAspectRatio="none"
      >
        {WAVE_CONFIGS.map((wave, index) => (
          <motion.path
            key={wave.id}
            fill={wave.fill}
            d={wave.paths[0]}
            animate={
              prefersReducedMotion
                ? {}
                : {
                    d: wave.paths,
                  }
            }
            transition={{
              duration: wave.duration,
              delay: index * 0.8,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          />
        ))}
      </svg>

      {/* Top wave accent - inverted */}
      <svg
        className="absolute top-0 left-0 w-full h-28 md:h-40 rotate-180 opacity-60"
        viewBox="0 0 1000 200"
        preserveAspectRatio="none"
      >
        <motion.path
          d="M0,165 C250,140 350,190 500,165 C650,140 750,190 1000,165 L1000,200 L0,200 Z"
          fill="rgba(255, 107, 107, 0.03)"
          animate={
            prefersReducedMotion
              ? {}
              : {
                  d: [
                    "M0,165 C250,140 350,190 500,165 C650,140 750,190 1000,165 L1000,200 L0,200 Z",
                    "M0,175 C200,150 400,200 500,175 C600,150 800,200 1000,175 L1000,200 L0,200 Z",
                    "M0,165 C250,140 350,190 500,165 C650,140 750,190 1000,165 L1000,200 L0,200 Z",
                  ],
                }
          }
          transition={{
            duration: 18,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      </svg>

      {/* Floating soft particles */}
      {!prefersReducedMotion && [...Array(6)].map((_, i) => (
        <motion.div
          key={`particle-${i}`}
          className="absolute rounded-full"
          style={{
            width: 4 + (i % 3) * 2,
            height: 4 + (i % 3) * 2,
            background: `rgba(255, 107, 107, ${0.12 + (i % 3) * 0.04})`,
            left: `${12 + i * 14}%`,
            top: `${25 + (i % 4) * 18}%`,
            filter: "blur(1px)",
          }}
          animate={{
            y: [0, -25, 0],
            opacity: [0.3, 0.6, 0.3],
            scale: [1, 1.3, 1],
          }}
          transition={{
            duration: 5 + i * 0.7,
            delay: i * 0.5,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      ))}

      {/* Center radial glow - slide-reactive intensity */}
      <motion.div
        className="absolute pointer-events-none"
        style={{
          width: "90vw",
          height: "90vw",
          maxWidth: "900px",
          maxHeight: "900px",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          background: `radial-gradient(circle, rgba(255, 107, 107, 0.06) 0%, rgba(255, 200, 180, 0.03) 40%, transparent 65%)`,
          filter: "blur(50px)",
        }}
        animate={
          prefersReducedMotion
            ? {}
            : {
                scale: [1, 1.06, 1],
                opacity: [0.7, 0.85, 0.7],
              }
        }
        transition={{
          duration: 10,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />

      {/* Slide-specific accent overlays */}
      <motion.div
        className="absolute inset-0 pointer-events-none"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5 }}
        style={{
          background: getSlideAccent(slideIndex),
        }}
      />

      {/* Soft radial vignette - focuses attention to center */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse 85% 85% at 50% 50%, transparent 35%, rgba(255, 250, 245, 0.5) 100%)`,
        }}
      />

      {/* Premium noise texture */}
      <div
        className="absolute inset-0 opacity-[0.012] pointer-events-none"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
          mixBlendMode: "multiply",
        }}
      />
    </div>
  );
}

// Slide-specific accent gradients for storytelling flow
function getSlideAccent(slideIndex: number): string {
  const accents = [
    // Slide 0: Destination - Warm coral top-left
    "radial-gradient(ellipse 50% 35% at 15% 15%, rgba(255, 107, 107, 0.08) 0%, transparent 70%)",
    // Slide 1: Itinerary - Teal accent right
    "radial-gradient(ellipse 45% 40% at 85% 35%, rgba(0, 180, 166, 0.07) 0%, transparent 70%)",
    // Slide 2: Map - Gold center warmth
    "radial-gradient(ellipse 55% 45% at 50% 50%, rgba(255, 217, 61, 0.06) 0%, transparent 65%)",
    // Slide 3: Templates - Coral bottom-left
    "radial-gradient(ellipse 50% 40% at 25% 75%, rgba(255, 107, 107, 0.07) 0%, transparent 70%)",
    // Slide 4: CTA - Multi-glow celebration
    `radial-gradient(ellipse 40% 30% at 20% 40%, rgba(255, 107, 107, 0.1) 0%, transparent 60%),
     radial-gradient(ellipse 40% 30% at 80% 60%, rgba(0, 180, 166, 0.08) 0%, transparent 60%),
     radial-gradient(ellipse 35% 25% at 50% 85%, rgba(255, 217, 61, 0.07) 0%, transparent 60%)`,
  ];
  return accents[slideIndex] || accents[0];
}
