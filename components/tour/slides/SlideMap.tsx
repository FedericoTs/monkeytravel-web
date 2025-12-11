"use client";

import { motion } from "framer-motion";
import TourPhone from "../TourPhone";
import { textContainerVariants, textItemVariants, featureCardVariants, pinVariants, BOUNCY_SPRING } from "../animations";

const HERO_SCREENSHOT = "/screenshots/trip-barcelona-hero.png";

export default function SlideMap() {
  return (
    <div className="relative w-full min-h-full flex items-center justify-center px-4 md:px-8 py-4">
      <div className="w-full max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-16 items-center">
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
            className="inline-flex items-center gap-2.5 px-4 py-2 rounded-full bg-[var(--navy)]/40 backdrop-blur-md border border-white/15 mb-6"
          >
            <span className="w-2.5 h-2.5 rounded-full bg-[var(--primary)] shadow-sm shadow-[var(--primary)]/50" />
            <span className="text-sm text-white/90 font-medium tracking-wide" style={{ fontFamily: "var(--font-source-sans), system-ui, sans-serif" }}>Step 3 of 4</span>
          </motion.div>

          {/* Headline */}
          <motion.h2
            variants={textItemVariants}
            className="text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-4 leading-tight"
            style={{ fontFamily: "var(--font-playfair), Georgia, serif" }}
          >
            Navigate Your
            <br />
            <span className="text-[var(--primary)]">Adventure</span>
          </motion.h2>

          {/* Description */}
          <motion.p
            variants={textItemVariants}
            className="text-lg md:text-xl text-white/80 mb-8 max-w-md mx-auto lg:mx-0"
          >
            See all your stops on an interactive map. Navigate with one tap, verify locations, and never get lost.
          </motion.p>

          {/* Feature highlights */}
          <div className="space-y-3">
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
                className="flex items-center gap-3.5 bg-[var(--navy)]/35 backdrop-blur-md rounded-2xl px-5 py-3.5 border border-white/10 max-w-sm mx-auto lg:mx-0 hover:bg-[var(--navy)]/50 hover:border-[var(--primary)]/30 transition-all duration-300"
              >
                <span className="text-2xl drop-shadow-sm">{feature.icon}</span>
                <span className="text-white/90 font-medium" style={{ fontFamily: "var(--font-source-sans), system-ui, sans-serif" }}>{feature.text}</span>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  );
}

// Animated map pins overlay
function MapPins() {
  // Map area in trip-barcelona-hero.png spans roughly 33-88% vertically
  const pins = [
    { top: "45%", left: "20%" },
    { top: "55%", left: "50%" },
    { top: "65%", left: "35%" },
    { top: "58%", left: "70%" },
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
            className="absolute w-4 h-2 bg-black/30 rounded-full blur-sm -bottom-1 left-1/2 -translate-x-1/2"
          />

          {/* Pin */}
          <motion.div
            animate={{
              y: [0, -4, 0],
            }}
            transition={{
              duration: 1.5,
              repeat: Infinity,
              repeatDelay: index * 0.5,
              ease: "easeInOut",
            }}
            className="relative"
          >
            {/* Pin body */}
            <div className="w-6 h-6 bg-[var(--primary)] rounded-full flex items-center justify-center shadow-lg border-2 border-white">
              <span className="text-white text-xs font-bold">{index + 1}</span>
            </div>

            {/* Pin tail */}
            <div
              className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0"
              style={{
                borderLeft: "5px solid transparent",
                borderRight: "5px solid transparent",
                borderTop: "8px solid var(--primary)",
                marginTop: "-2px",
              }}
            />
          </motion.div>

          {/* Ripple effect */}
          <motion.div
            initial={{ scale: 0.5, opacity: 0.5 }}
            animate={{
              scale: [0.5, 2, 2],
              opacity: [0.5, 0.2, 0],
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
              repeatDelay: index * 0.3,
              ease: "easeOut",
            }}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-[var(--primary)]"
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
          d="M 20 45 Q 28 55 35 65 Q 42 58 50 55 Q 60 56 70 58"
          fill="none"
          stroke="var(--primary)"
          strokeWidth="0.8"
          strokeLinecap="round"
          strokeDasharray="3 2"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 0.6 }}
          transition={{
            pathLength: { duration: 2, delay: 1.5, ease: "easeInOut" },
            opacity: { duration: 0.5, delay: 1 },
          }}
        />
      </svg>
    </>
  );
}
