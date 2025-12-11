"use client";

import { motion } from "framer-motion";
import TourPhone from "../TourPhone";
import { textContainerVariants, textItemVariants, featureCardVariants } from "../animations";

const ITINERARY_SCREENSHOT = "/screenshots/trip-barcelona-itinerary.png";

export default function SlideItinerary() {
  return (
    <div className="relative w-full h-full flex items-center justify-center px-3 md:px-8">
      <div className="w-full max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-8 lg:gap-16 items-center">
        {/* Text Content - Left on desktop */}
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
            <span className="w-2 h-2 rounded-full bg-[var(--secondary)]" />
            <span className="text-xs md:text-sm text-white/80 font-medium">Step 2 of 4</span>
          </motion.div>

          {/* Headline */}
          <motion.h2
            variants={textItemVariants}
            className="text-2xl md:text-4xl lg:text-5xl font-bold text-white mb-2 md:mb-4 leading-tight"
            style={{ fontFamily: "var(--font-playfair), Georgia, serif" }}
          >
            AI Magic in{" "}
            <span className="text-[var(--secondary)]">30 Seconds</span>
          </motion.h2>

          {/* Description */}
          <motion.p
            variants={textItemVariants}
            className="text-sm md:text-lg text-white/70 mb-4 md:mb-8 max-w-md mx-auto lg:mx-0"
          >
            Get a complete day-by-day itinerary with perfect timing.
          </motion.p>

          {/* Feature highlights */}
          <div className="hidden sm:flex flex-col gap-2 md:gap-3">
            {[
              { icon: "📅", text: "Day-by-day schedule" },
              { icon: "🚶", text: "Walking times included" },
              { icon: "💰", text: "Budget estimates" },
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
            <span>📅 Scheduled</span>
            <span>🚶 Timed</span>
            <span>💰 Budget</span>
          </div>
        </motion.div>

        {/* Phone Mockup - Right on desktop */}
        <div className="order-1 lg:order-2 flex justify-center relative">
          <TourPhone
            screenImage={ITINERARY_SCREENSHOT}
            variant="left"
            size="lg"
            delay={0.2}
          >
            {/* Animated highlight overlays on the phone */}
            <ActivityHighlight
              delay={1.0}
              position={{ top: "14%", left: "4%", width: "92%", height: "32%" }}
              label="Activity cards"
            />
            <ActivityHighlight
              delay={1.5}
              position={{ top: "47%", left: "22%", width: "56%", height: "4%" }}
              label="Walking time"
              small
            />
          </TourPhone>
        </div>
      </div>
    </div>
  );
}

// Activity highlight component with label
interface ActivityHighlightProps {
  delay: number;
  position: { top: string; left: string; width: string; height: string };
  label: string;
  small?: boolean;
}

function ActivityHighlight({ delay, position, label, small = false }: ActivityHighlightProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{
        opacity: [0, 1, 1, 0],
        scale: [0.9, 1, 1, 0.9],
      }}
      transition={{
        duration: 3,
        delay,
        repeat: Infinity,
        repeatDelay: 2,
        times: [0, 0.1, 0.9, 1],
      }}
      className="absolute z-10 pointer-events-none"
      style={{
        top: position.top,
        left: position.left,
        width: position.width,
        height: position.height,
      }}
    >
      {/* Highlight border - thinner on mobile */}
      <div
        className={`absolute inset-0 border border-[var(--accent)] md:border-2 ${small ? "rounded-md md:rounded-lg" : "rounded-xl md:rounded-2xl"}`}
        style={{
          boxShadow: "0 0 12px 2px rgba(255, 217, 61, 0.3)",
        }}
      />

      {/* Label - hidden on mobile to reduce visual clutter */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: delay + 0.2 }}
        className={`hidden md:block absolute ${small ? "-top-6" : "-top-8"} left-1/2 -translate-x-1/2 whitespace-nowrap`}
      >
        <span className="bg-[var(--accent)] text-[var(--primary-dark)] text-xs font-bold px-2 py-1 rounded-full shadow-lg">
          {label}
        </span>
      </motion.div>
    </motion.div>
  );
}
