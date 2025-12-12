"use client";

import { motion, Variants } from "framer-motion";
import { useReducedMotion } from "../hooks/useReducedMotion";

interface PhoneScreenProps {
  children: React.ReactNode;
  variant?: "center" | "left" | "right";
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
  delay?: number;
}

const SIZE_CLASSES = {
  xs: "w-[140px] md:w-[200px]",
  sm: "w-[160px] md:w-[220px]",
  md: "w-[180px] md:w-[260px]",
  lg: "w-[200px] md:w-[300px]",
};

// Animation variants
const phoneVariants: Variants = {
  hidden: {
    opacity: 0,
    y: 60,
    scale: 0.9,
    rotateX: 15,
  },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    rotateX: 0,
  },
  exit: {
    opacity: 0,
    y: -40,
    scale: 0.95,
  },
};

const phoneTiltLeftVariants: Variants = {
  hidden: {
    opacity: 0,
    x: -80,
    rotateY: 25,
    scale: 0.85,
  },
  visible: {
    opacity: 1,
    x: 0,
    rotateY: 8,
    scale: 1,
  },
  exit: {
    opacity: 0,
    x: -60,
  },
};

const phoneTiltRightVariants: Variants = {
  hidden: {
    opacity: 0,
    x: 80,
    rotateY: -25,
    scale: 0.85,
  },
  visible: {
    opacity: 1,
    x: 0,
    rotateY: -8,
    scale: 1,
  },
  exit: {
    opacity: 0,
    x: 60,
  },
};

const CINEMATIC_SPRING = {
  type: "spring" as const,
  stiffness: 100,
  damping: 15,
  mass: 1,
};

export default function PhoneScreen({
  children,
  variant = "center",
  size = "lg",
  className = "",
  delay = 0,
}: PhoneScreenProps) {
  const prefersReducedMotion = useReducedMotion();

  const getVariants = (): Variants => {
    if (prefersReducedMotion) {
      return {
        hidden: { opacity: 0 },
        visible: { opacity: 1, transition: { duration: 0.3 } },
      };
    }

    switch (variant) {
      case "left":
        return phoneTiltLeftVariants;
      case "right":
        return phoneTiltRightVariants;
      default:
        return phoneVariants;
    }
  };

  const variants = getVariants();

  const delayedVariants: Variants = {
    ...variants,
    visible: {
      ...(variants.visible as object),
      transition: {
        ...CINEMATIC_SPRING,
        delay,
      },
    },
  };

  return (
    <motion.div
      variants={delayedVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className={`relative ${SIZE_CLASSES[size]} ${className}`}
      style={{
        perspective: "1000px",
        transformStyle: "preserve-3d",
      }}
    >
      {/* Premium drop shadow */}
      <div
        className="absolute inset-0 rounded-[2.5rem] blur-[40px] opacity-40"
        style={{
          background: "rgba(0, 0, 0, 0.5)",
          transform: "translateY(20px) scale(0.9)",
        }}
      />

      {/* Phone Frame */}
      <div className="relative bg-gray-900 rounded-[2.5rem] p-2 shadow-2xl">
        {/* Subtle phone frame gradient for depth */}
        <div
          className="absolute inset-0 rounded-[2.5rem] opacity-50"
          style={{
            background: `
              linear-gradient(
                145deg,
                rgba(255, 255, 255, 0.1) 0%,
                transparent 50%,
                rgba(0, 0, 0, 0.2) 100%
              )
            `,
          }}
        />

        {/* Inner bezel */}
        <div className="relative bg-black rounded-[2.25rem] overflow-hidden">
          {/* Dynamic Island */}
          <div className="absolute top-3 left-1/2 -translate-x-1/2 w-24 h-7 bg-black rounded-full z-20 flex items-center justify-center gap-3">
            <div className="w-2 h-2 rounded-full bg-gray-800" />
            <div className="w-3 h-3 rounded-full bg-gray-800 ring-1 ring-gray-700" />
          </div>

          {/* Screen content - React components render here */}
          <div className="relative aspect-[9/19.5] overflow-hidden bg-[#FFFAF5]">
            {children}
          </div>
        </div>

        {/* Side buttons */}
        <div className="absolute left-0 top-28 w-0.5 h-6 bg-gray-700 rounded-l" />
        <div className="absolute left-0 top-40 w-0.5 h-10 bg-gray-700 rounded-l" />
        <div className="absolute left-0 top-52 w-0.5 h-10 bg-gray-700 rounded-l" />
        <div className="absolute right-0 top-36 w-0.5 h-14 bg-gray-700 rounded-r" />
      </div>

      {/* Screen reflection effect */}
      <div
        className="absolute inset-0 rounded-[2.5rem] pointer-events-none opacity-30"
        style={{
          background: `
            linear-gradient(
              135deg,
              rgba(255, 255, 255, 0.2) 0%,
              transparent 40%,
              transparent 60%,
              rgba(255, 255, 255, 0.05) 100%
            )
          `,
        }}
      />
    </motion.div>
  );
}

// Cascade phone for CTA slide
interface CascadePhoneScreenProps {
  children: React.ReactNode;
  index: number; // 0 = left, 1 = center, 2 = right
  className?: string;
}

export function CascadePhoneScreen({
  children,
  index,
  className = "",
}: CascadePhoneScreenProps) {
  const prefersReducedMotion = useReducedMotion();

  const isCenter = index === 1;
  const rotation = index === 0 ? -8 : index === 2 ? 8 : 0;
  const scale = isCenter ? 1 : 0.85;
  const zIndex = isCenter ? 10 : 5;

  return (
    <motion.div
      initial={prefersReducedMotion ? { opacity: 0 } : { y: 150, opacity: 0, scale: 0.8 }}
      animate={
        prefersReducedMotion
          ? { opacity: 1 }
          : { y: 0, opacity: 1, scale, rotateZ: rotation }
      }
      transition={{
        type: "spring",
        stiffness: 100,
        damping: 15,
        delay: 0.3 + index * 0.15,
      }}
      className={`relative ${isCenter ? "w-[140px] md:w-[220px]" : "w-[110px] md:w-[170px]"} ${className}`}
      style={{ zIndex }}
    >
      {/* Shadow */}
      <div
        className="absolute inset-0 rounded-[2rem] blur-[30px] opacity-30"
        style={{
          background: "rgba(0, 0, 0, 0.5)",
          transform: "translateY(15px) scale(0.9)",
        }}
      />

      {/* Phone */}
      <div className="relative bg-gray-900 rounded-[2rem] p-1.5 shadow-xl">
        <div className="relative bg-black rounded-[1.75rem] overflow-hidden">
          {/* Dynamic Island */}
          <div className="absolute top-2 left-1/2 -translate-x-1/2 w-16 h-5 bg-black rounded-full z-10" />

          {/* Screen */}
          <div className="relative aspect-[9/19.5] overflow-hidden bg-[#FFFAF5]">
            {children}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
