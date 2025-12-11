/**
 * Cinematic Animation Variants for Product Tour
 *
 * Apple-quality animations with premium easing and physics
 */

import type { Variants, Transition } from "framer-motion";

// Premium easing curves
export const PREMIUM_EASE = [0.25, 0.1, 0.25, 1.0] as const;
export const BOUNCE_EASE = [0.68, -0.55, 0.265, 1.55] as const;
export const SMOOTH_EASE = [0.4, 0, 0.2, 1] as const;

// Spring physics configurations
export const CINEMATIC_SPRING: Transition = {
  type: "spring",
  stiffness: 100,
  damping: 15,
  mass: 1,
};

export const GENTLE_SPRING: Transition = {
  type: "spring",
  stiffness: 80,
  damping: 20,
  mass: 0.8,
};

export const BOUNCY_SPRING: Transition = {
  type: "spring",
  stiffness: 300,
  damping: 20,
  mass: 0.5,
};

// Slide transition variants
export const slideVariants: Variants = {
  enter: (direction: number) => ({
    x: direction > 0 ? "100%" : "-100%",
    opacity: 0,
    scale: 0.95,
  }),
  center: {
    x: 0,
    opacity: 1,
    scale: 1,
    transition: {
      duration: 0.6,
      ease: PREMIUM_EASE,
    },
  },
  exit: (direction: number) => ({
    x: direction < 0 ? "100%" : "-100%",
    opacity: 0,
    scale: 0.95,
    transition: {
      duration: 0.5,
      ease: PREMIUM_EASE,
    },
  }),
};

// Phone mockup variants
export const phoneVariants: Variants = {
  hidden: {
    y: 100,
    opacity: 0,
    scale: 0.85,
    rotateY: -10,
  },
  visible: {
    y: 0,
    opacity: 1,
    scale: 1,
    rotateY: 0,
    transition: {
      ...CINEMATIC_SPRING,
      delay: 0.2,
    },
  },
  exit: {
    y: 50,
    opacity: 0,
    scale: 0.9,
    transition: {
      duration: 0.3,
      ease: SMOOTH_EASE,
    },
  },
};

// Phone with 3D tilt (for alternating slides)
export const phoneTiltLeftVariants: Variants = {
  hidden: {
    x: -100,
    opacity: 0,
    scale: 0.85,
    rotateY: 15,
    rotateZ: -5,
  },
  visible: {
    x: 0,
    opacity: 1,
    scale: 1,
    rotateY: -5,
    rotateZ: 0,
    transition: {
      ...CINEMATIC_SPRING,
      delay: 0.3,
    },
  },
};

export const phoneTiltRightVariants: Variants = {
  hidden: {
    x: 100,
    opacity: 0,
    scale: 0.85,
    rotateY: -15,
    rotateZ: 5,
  },
  visible: {
    x: 0,
    opacity: 1,
    scale: 1,
    rotateY: 5,
    rotateZ: 0,
    transition: {
      ...CINEMATIC_SPRING,
      delay: 0.3,
    },
  },
};

// Text content variants with stagger
export const textContainerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.4,
    },
  },
};

export const textItemVariants: Variants = {
  hidden: {
    opacity: 0,
    y: 30,
  },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.5,
      ease: PREMIUM_EASE,
    },
  },
};

// Feature card variants (floating in from side)
export const featureCardVariants: Variants = {
  hidden: {
    x: -50,
    opacity: 0,
    scale: 0.9,
  },
  visible: (i: number) => ({
    x: 0,
    opacity: 1,
    scale: 1,
    transition: {
      ...GENTLE_SPRING,
      delay: 0.5 + i * 0.15,
    },
  }),
};

// Spotlight ring animation (pulsing glow)
export const spotlightVariants: Variants = {
  initial: {
    scale: 1,
    opacity: 0,
  },
  animate: {
    scale: [1, 1.05, 1],
    opacity: [0.6, 1, 0.6],
    boxShadow: [
      "0 0 0 0 rgba(255, 107, 107, 0)",
      "0 0 20px 4px rgba(255, 107, 107, 0.4)",
      "0 0 0 0 rgba(255, 107, 107, 0)",
    ],
    transition: {
      duration: 2,
      repeat: Infinity,
      ease: "easeInOut",
    },
  },
};

// Map pin pop-in animation
export const pinVariants: Variants = {
  hidden: {
    scale: 0,
    opacity: 0,
    y: 20,
  },
  visible: (i: number) => ({
    scale: 1,
    opacity: 1,
    y: 0,
    transition: {
      ...BOUNCY_SPRING,
      delay: 0.8 + i * 0.2,
    },
  }),
};

// CTA button pulse animation
export const ctaPulseVariants: Variants = {
  initial: {
    boxShadow: "0 0 0 0 rgba(255, 217, 61, 0)",
  },
  animate: {
    boxShadow: [
      "0 0 0 0 rgba(255, 217, 61, 0)",
      "0 0 0 8px rgba(255, 217, 61, 0.3)",
      "0 0 0 16px rgba(255, 217, 61, 0)",
    ],
    transition: {
      duration: 2,
      repeat: Infinity,
      ease: "easeInOut",
    },
  },
};

// Background Ken Burns variants
export const kenBurnsVariants: Variants = {
  initial: {
    scale: 1,
    x: 0,
    y: 0,
  },
  animate: {
    scale: 1.1,
    x: "-2%",
    y: "-1%",
    transition: {
      duration: 10,
      ease: "linear",
      repeat: Infinity,
      repeatType: "reverse",
    },
  },
};

// Background crossfade for final slide
export const crossfadeVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      duration: 1.5,
      ease: SMOOTH_EASE,
    },
  },
  exit: {
    opacity: 0,
    transition: {
      duration: 1.5,
      ease: SMOOTH_EASE,
    },
  },
};

// Cascade animation for multiple phones
export const phoneCascadeVariants: Variants = {
  hidden: {
    y: 150,
    opacity: 0,
    scale: 0.8,
  },
  visible: (i: number) => ({
    y: 0,
    opacity: 1,
    scale: i === 1 ? 1 : 0.85, // Center phone larger
    rotateZ: i === 0 ? -8 : i === 2 ? 8 : 0,
    transition: {
      ...CINEMATIC_SPRING,
      delay: 0.3 + i * 0.15,
    },
  }),
};

// Progress dot variants
export const dotVariants: Variants = {
  inactive: {
    scale: 1,
    backgroundColor: "rgba(255, 255, 255, 0.4)",
  },
  active: {
    scale: 1.3,
    backgroundColor: "rgba(255, 255, 255, 1)",
    transition: {
      duration: 0.3,
      ease: PREMIUM_EASE,
    },
  },
};
