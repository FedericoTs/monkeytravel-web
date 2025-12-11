"use client";

import { motion, Variants } from "framer-motion";
import Image from "next/image";
import { phoneVariants, phoneTiltLeftVariants, phoneTiltRightVariants, CINEMATIC_SPRING } from "./animations";
import { useReducedMotion } from "./hooks/useReducedMotion";

interface TourPhoneProps {
  screenImage: string;
  variant?: "center" | "left" | "right";
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
  delay?: number;
  showSpotlight?: boolean;
  spotlightPosition?: { top: string; left: string; width: string; height: string };
  children?: React.ReactNode;
}

const SIZE_CLASSES = {
  xs: "w-[140px] md:w-[200px]",  // Compact mobile
  sm: "w-[160px] md:w-[220px]",
  md: "w-[180px] md:w-[260px]",
  lg: "w-[200px] md:w-[300px]",  // Slightly smaller for no-scroll mobile
};

export default function TourPhone({
  screenImage,
  variant = "center",
  size = "lg",
  className = "",
  delay = 0,
  showSpotlight = false,
  spotlightPosition,
  children,
}: TourPhoneProps) {
  const prefersReducedMotion = useReducedMotion();

  // Select variant based on position
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

  // Add delay to variants
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

          {/* Screen content */}
          <div className="relative aspect-[9/19.5] overflow-hidden">
            <Image
              src={screenImage}
              alt="App screenshot"
              fill
              className="object-cover object-top"
              priority
              sizes="(max-width: 768px) 260px, 320px"
            />

            {/* Spotlight overlay */}
            {showSpotlight && spotlightPosition && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{
                  opacity: [0.5, 1, 0.5],
                  scale: [1, 1.05, 1],
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: 1,
                }}
                className="absolute z-10 border-2 border-[var(--accent)] rounded-xl pointer-events-none"
                style={{
                  top: spotlightPosition.top,
                  left: spotlightPosition.left,
                  width: spotlightPosition.width,
                  height: spotlightPosition.height,
                  boxShadow: "0 0 20px 4px rgba(242, 198, 65, 0.5)",
                }}
              />
            )}

            {/* Children for additional overlays */}
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

// Export a simpler version for the cascade (3 phones)
interface CascadePhoneProps {
  screenImage: string;
  index: number; // 0 = left, 1 = center, 2 = right
  className?: string;
}

export function CascadePhone({ screenImage, index, className = "" }: CascadePhoneProps) {
  const prefersReducedMotion = useReducedMotion();

  const isCenter = index === 1;
  const rotation = index === 0 ? -8 : index === 2 ? 8 : 0;
  const scale = isCenter ? 1 : 0.85;
  const zIndex = isCenter ? 10 : 5;

  return (
    <motion.div
      initial={prefersReducedMotion ? { opacity: 0 } : { y: 150, opacity: 0, scale: 0.8 }}
      animate={prefersReducedMotion
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
          <div className="relative aspect-[9/19.5] overflow-hidden">
            <Image
              src={screenImage}
              alt="Trip preview"
              fill
              className="object-cover object-top"
              sizes="(max-width: 768px) 200px, 260px"
            />
          </div>
        </div>
      </div>
    </motion.div>
  );
}
