"use client";

import { motion } from "framer-motion";
import TourPhone from "../TourPhone";
import { textContainerVariants, textItemVariants, featureCardVariants, pinVariants } from "../animations";

const HERO_SCREENSHOT = "/screenshots/trip-barcelona-hero.png";

export default function SlideMap() {
  return (
    <div className="relative w-full h-full flex items-center justify-center px-3 md:px-8">
      <div className="w-full max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-8 lg:gap-16 items-center">
        {/* Phone Mockup with Map */}
        <div className="order-1 lg:order-2 flex justify-center relative">
          <TourPhone
            screenImage={HERO_SCREENSHOT}
            variant="center"
            size="lg"
            delay={0.2}
          >
            {/* Animated Map Pins */}
            <MapPins />
          </TourPhone>
        </div>

        {/* Text Content */}
        <motion.div
          variants={textContainerVariants}
          initial="hidden"
          animate="visible"
          className="order-2 lg:order-1 text-center lg:text-left"
        >
          {/* Slide indicator */}
          <motion.div
            variants={textItemVariants}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/20 backdrop-blur-md border border-white/10 mb-3 md:mb-6"
          >
            <span className="w-2 h-2 rounded-full bg-[var(--primary)]" />
            <span className="text-xs md:text-sm text-white/80 font-medium">Step 3 of 4</span>
          </motion.div>

          {/* Headline */}
          <motion.h2
            variants={textItemVariants}
            className="text-2xl md:text-4xl lg:text-5xl font-bold text-white mb-2 md:mb-4 leading-tight"
            style={{ fontFamily: "var(--font-playfair), Georgia, serif" }}
          >
            Navigate Your{" "}
            <span className="text-[var(--primary)]">Adventure</span>
          </motion.h2>

          {/* Description */}
          <motion.p
            variants={textItemVariants}
            className="text-sm md:text-lg text-white/70 mb-4 md:mb-8 max-w-md mx-auto lg:mx-0"
          >
            See all your stops on an interactive map. Never get lost.
          </motion.p>

          {/* Feature highlights */}
          <div className="hidden sm:flex flex-col gap-2 md:gap-3">
            {[
              { icon: "🗺️", text: "Interactive map view" },
              { icon: "📍", text: "One-tap Google Maps" },
              { icon: "✅", text: "Verify every location" },
            ].map((feature, index) => (
              <motion.div
                key={index}
                variants={featureCardVariants}
                custom={index}
                initial="hidden"
                animate="visible"
                className="flex items-center gap-3 bg-black/15 backdrop-blur-sm rounded-xl px-4 py-2.5 md:px-5 md:py-3.5 border border-white/5 max-w-sm mx-auto lg:mx-0"
              >
                <span className="text-lg md:text-2xl">{feature.icon}</span>
                <span className="text-white/80 text-sm md:text-base font-medium">{feature.text}</span>
              </motion.div>
            ))}
          </div>

          {/* Mobile-only compact features */}
          <div className="flex sm:hidden justify-center gap-4 text-white/60 text-xs">
            <span>🗺️ Map view</span>
            <span>📍 Navigate</span>
            <span>✅ Verified</span>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

// Animated map pins overlay
function MapPins() {
  // Map area in trip-barcelona-hero.png spans ~28-85% vertically
  const pins = [
    { top: "38%", left: "25%" },
    { top: "48%", left: "55%" },
    { top: "58%", left: "40%" },
    { top: "52%", left: "72%" },
  ];

  return (
    <>
      {pins.map((pos, index) => (
        <motion.div
          key={index}
          variants={pinVariants}
          custom={index}
          initial="hidden"
          animate="visible"
          className="absolute z-10 pointer-events-none"
          style={{ top: pos.top, left: pos.left }}
        >
          {/* Pin shadow */}
          <div
            className="absolute w-2 md:w-3 h-1 md:h-1.5 bg-black/30 rounded-full blur-sm -bottom-0.5 md:-bottom-1 left-1/2 -translate-x-1/2"
          />

          {/* Pin */}
          <motion.div
            animate={{
              y: [0, -2, 0],
            }}
            transition={{
              duration: 1.5,
              repeat: Infinity,
              repeatDelay: index * 0.5,
              ease: "easeInOut",
            }}
            className="relative"
          >
            {/* Pin body - smaller on mobile */}
            <div className="w-4 h-4 md:w-5 md:h-5 bg-[var(--primary)] rounded-full flex items-center justify-center shadow-lg border md:border-2 border-white">
              <span className="text-white text-[8px] md:text-[10px] font-bold">{index + 1}</span>
            </div>

            {/* Pin tail - smaller on mobile */}
            <div
              className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0"
              style={{
                borderLeft: "3px solid transparent",
                borderRight: "3px solid transparent",
                borderTop: "5px solid var(--primary)",
                marginTop: "-2px",
              }}
            />
          </motion.div>

          {/* Ripple effect */}
          <motion.div
            initial={{ scale: 0.5, opacity: 0.5 }}
            animate={{
              scale: [0.5, 1.6, 1.6],
              opacity: [0.5, 0.2, 0],
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
              repeatDelay: index * 0.3,
              ease: "easeOut",
            }}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 md:w-5 md:h-5 rounded-full bg-[var(--primary)]"
          />
        </motion.div>
      ))}

      {/* Connecting route line (animated dash) */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none z-5"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        <motion.path
          d="M 25 38 Q 32 45 40 58 Q 48 52 55 48 Q 63 50 72 52"
          fill="none"
          stroke="var(--primary)"
          strokeWidth="0.6"
          strokeLinecap="round"
          strokeDasharray="2 1.5"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 0.5 }}
          transition={{
            pathLength: { duration: 2, delay: 1.5, ease: "easeInOut" },
            opacity: { duration: 0.5, delay: 1 },
          }}
        />
      </svg>
    </>
  );
}
