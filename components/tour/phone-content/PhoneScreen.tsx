"use client";

import { motion, Variants } from "framer-motion";
import { useReducedMotion } from "../hooks/useReducedMotion";

interface PhoneScreenProps {
  children: React.ReactNode;
  variant?: "center" | "left" | "right";
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
  delay?: number;
  // New: Allow elements to break out of phone frame
  allowOverflow?: boolean;
  // New: Render breakout elements outside the phone
  breakoutElements?: React.ReactNode;
}

// Refined sizes with proper iPhone proportions
const SIZE_CLASSES = {
  xs: "w-[130px] md:w-[180px]",
  sm: "w-[155px] md:w-[220px]",
  md: "w-[185px] md:w-[270px]",
  lg: "w-[210px] md:w-[320px]",
  xl: "w-[240px] md:w-[360px]",
};

// Premium animation variants - cinematic entrance
const phoneVariants: Variants = {
  hidden: {
    opacity: 0,
    y: 80,
    scale: 0.85,
    rotateX: 20,
  },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    rotateX: 0,
  },
  exit: {
    opacity: 0,
    y: -50,
    scale: 0.9,
    transition: { duration: 0.3 },
  },
};

const phoneTiltLeftVariants: Variants = {
  hidden: {
    opacity: 0,
    x: -100,
    rotateY: 30,
    scale: 0.8,
  },
  visible: {
    opacity: 1,
    x: 0,
    rotateY: 10,
    scale: 1,
  },
  exit: {
    opacity: 0,
    x: -80,
    transition: { duration: 0.3 },
  },
};

const phoneTiltRightVariants: Variants = {
  hidden: {
    opacity: 0,
    x: 100,
    rotateY: -30,
    scale: 0.8,
  },
  visible: {
    opacity: 1,
    x: 0,
    rotateY: -10,
    scale: 1,
  },
  exit: {
    opacity: 0,
    x: 80,
    transition: { duration: 0.3 },
  },
};

// Premium spring physics
const CINEMATIC_SPRING = {
  type: "spring" as const,
  stiffness: 85,
  damping: 14,
  mass: 1.2,
};

export default function PhoneScreen({
  children,
  variant = "center",
  size = "lg",
  className = "",
  delay = 0,
  allowOverflow = false,
  breakoutElements,
}: PhoneScreenProps) {
  const prefersReducedMotion = useReducedMotion();

  const getVariants = (): Variants => {
    if (prefersReducedMotion) {
      return {
        hidden: { opacity: 0 },
        visible: { opacity: 1, transition: { duration: 0.4 } },
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
        perspective: "1200px",
        transformStyle: "preserve-3d",
      }}
    >
      {/* AI Voice Assistant Coral Orb - Glassmorphism Style */}
      {/* Ultra-soft, low opacity glow behind frosted glass effect */}

      {/* Primary soft glow - very subtle, large blur */}
      <motion.div
        className="absolute pointer-events-none z-[-1]"
        style={{
          width: "220%",
          height: "180%",
          left: "-60%",
          top: "-40%",
          background: `
            radial-gradient(
              ellipse 55% 45% at 50% 50%,
              rgba(255, 138, 128, 0.18) 0%,
              rgba(255, 107, 107, 0.12) 30%,
              rgba(255, 171, 145, 0.06) 60%,
              transparent 85%
            )
          `,
          filter: "blur(60px)",
        }}
        animate={{
          scale: [1, 1.03, 0.98, 1.02, 1],
          x: ["0%", "2%", "-1%", "1%", "0%"],
          y: ["0%", "-1%", "2%", "-0.5%", "0%"],
        }}
        transition={{
          duration: 12,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />

      {/* Secondary ambient glow - warmer, offset */}
      <motion.div
        className="absolute pointer-events-none z-[-2]"
        style={{
          width: "180%",
          height: "160%",
          left: "-40%",
          top: "-30%",
          background: `
            radial-gradient(
              ellipse 50% 55% at 55% 45%,
              rgba(255, 205, 210, 0.12) 0%,
              rgba(255, 138, 128, 0.08) 40%,
              transparent 75%
            )
          `,
          filter: "blur(80px)",
        }}
        animate={{
          scale: [1, 0.97, 1.04, 0.99, 1],
          x: ["0%", "-2%", "1.5%", "-0.5%", "0%"],
          y: ["0%", "1.5%", "-1%", "0.5%", "0%"],
        }}
        transition={{
          duration: 15,
          repeat: Infinity,
          ease: "easeInOut",
          delay: 0.5,
        }}
      />

      {/* Subtle accent highlight - very faint top-left */}
      <motion.div
        className="absolute pointer-events-none z-[-3]"
        style={{
          width: "120%",
          height: "100%",
          left: "-40%",
          top: "-30%",
          background: `
            radial-gradient(
              ellipse 40% 35% at 40% 40%,
              rgba(255, 224, 178, 0.08) 0%,
              rgba(255, 183, 77, 0.04) 50%,
              transparent 80%
            )
          `,
          filter: "blur(50px)",
        }}
        animate={{
          opacity: [0.8, 1, 0.7, 0.9, 0.8],
          scale: [1, 1.05, 0.95, 1.02, 1],
        }}
        transition={{
          duration: 10,
          repeat: Infinity,
          ease: "easeInOut",
          delay: 1,
        }}
      />

      {/* Premium layered shadow for depth */}
      <div
        className="absolute inset-0 rounded-[2.8rem] opacity-25"
        style={{
          background: "rgba(0, 0, 0, 0.8)",
          filter: "blur(50px)",
          transform: "translateY(30px) scale(0.85)",
        }}
      />
      <div
        className="absolute inset-0 rounded-[2.8rem] opacity-40"
        style={{
          background: "rgba(0, 0, 0, 0.6)",
          filter: "blur(25px)",
          transform: "translateY(15px) scale(0.92)",
        }}
      />

      {/* Phone Frame - Titanium finish */}
      <div
        className="relative rounded-[2.8rem] p-[3px]"
        style={{
          background: `linear-gradient(
            145deg,
            #4a4a4a 0%,
            #2d2d2d 50%,
            #1a1a1a 100%
          )`,
          boxShadow: `
            inset 0 1px 0 rgba(255,255,255,0.15),
            inset 0 -1px 0 rgba(0,0,0,0.3)
          `,
        }}
      >
        {/* Inner bezel - deep black */}
        <div
          className={`relative bg-black rounded-[2.6rem] ${allowOverflow ? '' : 'overflow-hidden'}`}
        >
          {/* Dynamic Island - realistic proportions */}
          <div
            className="absolute top-3 left-1/2 -translate-x-1/2 z-30"
            style={{
              width: "min(95px, 35%)",
              height: "min(28px, 6%)",
            }}
          >
            <div
              className="w-full h-full bg-black rounded-full flex items-center justify-center gap-2"
              style={{
                boxShadow: "inset 0 1px 3px rgba(255,255,255,0.1)",
              }}
            >
              {/* Camera */}
              <div
                className="w-2.5 h-2.5 rounded-full"
                style={{
                  background: "radial-gradient(circle at 30% 30%, #1a1a3a 0%, #0a0a1a 100%)",
                  boxShadow: "0 0 2px rgba(30, 60, 114, 0.8), inset 0 0 3px rgba(0,0,0,0.8)",
                }}
              />
              {/* Sensor array */}
              <div
                className="w-1.5 h-1.5 rounded-full bg-gray-900"
                style={{
                  boxShadow: "inset 0 0 2px rgba(0,0,0,0.6)",
                }}
              />
            </div>
          </div>

          {/* Screen content area */}
          <div
            className={`relative ${allowOverflow ? '' : 'overflow-hidden'}`}
            style={{
              aspectRatio: "9 / 19.5",
              background: "linear-gradient(180deg, #FFFFFF 0%, #FFFAF5 100%)",
              borderRadius: "2.4rem",
            }}
          >
            {/* Status bar area - subtle */}
            <div className="absolute top-0 left-0 right-0 h-12 z-10 px-8 pt-1 flex items-center justify-between text-[8px] text-gray-600 font-medium">
              <span>9:41</span>
              <div className="flex items-center gap-1">
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12.33 4.67L18 10.33V20H6V10.33L11.67 4.67C11.85 4.49 12.15 4.49 12.33 4.67Z" />
                </svg>
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M2 17H22V19H2V17ZM4 13H20V15H4V13ZM7 9H17V11H7V9ZM11 5H13V7H11V5Z" />
                </svg>
                <div className="w-5 h-2 bg-gray-600 rounded-sm relative">
                  <div className="absolute inset-[1px] bg-gray-400 rounded-[1px]" style={{ width: "70%" }} />
                </div>
              </div>
            </div>

            {/* Main content */}
            {children}
          </div>

          {/* Home indicator */}
          <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-[35%] h-1 bg-gray-600 rounded-full z-20" />
        </div>

        {/* Side buttons - refined */}
        <div className="absolute left-0 top-[22%] w-[2px] h-[5%] bg-gray-600 rounded-l-sm" />
        <div className="absolute left-0 top-[32%] w-[2px] h-[8%] bg-gray-600 rounded-l-sm" />
        <div className="absolute left-0 top-[42%] w-[2px] h-[8%] bg-gray-600 rounded-l-sm" />
        <div className="absolute right-0 top-[30%] w-[2px] h-[12%] bg-gray-600 rounded-r-sm" />
      </div>

      {/* Glass reflection overlay */}
      <div
        className="absolute inset-0 rounded-[2.8rem] pointer-events-none"
        style={{
          background: `
            linear-gradient(
              135deg,
              rgba(255, 255, 255, 0.15) 0%,
              transparent 30%,
              transparent 70%,
              rgba(255, 255, 255, 0.05) 100%
            )
          `,
        }}
      />

      {/* Breakout elements - rendered outside phone frame */}
      {breakoutElements && (
        <div className="absolute inset-0 pointer-events-none z-40">
          {breakoutElements}
        </div>
      )}
    </motion.div>
  );
}

// Cascade phone arrangement for CTA slide
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
  const rotation = index === 0 ? -12 : index === 2 ? 12 : 0;
  const scale = isCenter ? 1 : 0.8;
  const zIndex = isCenter ? 10 : 5;
  const translateX = index === 0 ? "15%" : index === 2 ? "-15%" : "0%";

  return (
    <motion.div
      initial={
        prefersReducedMotion
          ? { opacity: 0 }
          : { y: 180, opacity: 0, scale: 0.7, rotateZ: rotation * 1.5 }
      }
      animate={
        prefersReducedMotion
          ? { opacity: 1 }
          : {
              y: 0,
              opacity: 1,
              scale,
              rotateZ: rotation,
              x: translateX,
            }
      }
      transition={{
        type: "spring",
        stiffness: 80,
        damping: 14,
        delay: 0.2 + index * 0.12,
      }}
      className={`relative ${isCenter ? "w-[150px] md:w-[240px]" : "w-[115px] md:w-[180px]"} ${className}`}
      style={{ zIndex }}
    >
      {/* Layered shadows */}
      <div
        className="absolute inset-0 rounded-[2.2rem] opacity-25"
        style={{
          background: "rgba(0, 0, 0, 0.7)",
          filter: "blur(35px)",
          transform: "translateY(20px) scale(0.88)",
        }}
      />

      {/* Phone frame */}
      <div
        className="relative rounded-[2.2rem] p-[2px]"
        style={{
          background: `linear-gradient(145deg, #3d3d3d 0%, #1d1d1d 100%)`,
        }}
      >
        <div className="relative bg-black rounded-[2.1rem] overflow-hidden">
          {/* Dynamic Island - compact */}
          <div className="absolute top-2 left-1/2 -translate-x-1/2 w-14 h-4 bg-black rounded-full z-10" />

          {/* Screen */}
          <div
            className="relative overflow-hidden"
            style={{
              aspectRatio: "9 / 19.5",
              background: "linear-gradient(180deg, #FFFFFF 0%, #FFFAF5 100%)",
              borderRadius: "2rem",
            }}
          >
            {children}
          </div>

          {/* Home indicator */}
          <div className="absolute bottom-1 left-1/2 -translate-x-1/2 w-[30%] h-0.5 bg-gray-600 rounded-full z-10" />
        </div>
      </div>

      {/* Reflection */}
      <div
        className="absolute inset-0 rounded-[2.2rem] pointer-events-none opacity-40"
        style={{
          background: `linear-gradient(135deg, rgba(255,255,255,0.2) 0%, transparent 50%)`,
        }}
      />
    </motion.div>
  );
}

// Floating breakout card component
interface BreakoutCardProps {
  children: React.ReactNode;
  position: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "left" | "right";
  delay?: number;
  className?: string;
}

export function BreakoutCard({
  children,
  position,
  delay = 0.5,
  className = "",
}: BreakoutCardProps) {
  const prefersReducedMotion = useReducedMotion();

  const positionStyles: Record<string, React.CSSProperties> = {
    "top-left": { top: "-10%", left: "-30%", transform: "rotate(-6deg)" },
    "top-right": { top: "-10%", right: "-30%", transform: "rotate(6deg)" },
    "bottom-left": { bottom: "5%", left: "-35%", transform: "rotate(-4deg)" },
    "bottom-right": { bottom: "5%", right: "-35%", transform: "rotate(4deg)" },
    "left": { top: "30%", left: "-40%", transform: "rotate(-8deg)" },
    "right": { top: "30%", right: "-40%", transform: "rotate(8deg)" },
  };

  return (
    <motion.div
      initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.6, y: 30 }}
      animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
      transition={{
        type: "spring",
        stiffness: 120,
        damping: 12,
        delay,
      }}
      className={`absolute pointer-events-none ${className}`}
      style={positionStyles[position]}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl p-3 border border-gray-100"
        style={{
          boxShadow: `
            0 25px 50px -12px rgba(0, 0, 0, 0.25),
            0 0 0 1px rgba(0, 0, 0, 0.05)
          `,
        }}
      >
        {children}
      </div>
    </motion.div>
  );
}
