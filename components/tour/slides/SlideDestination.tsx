"use client";

import { motion } from "framer-motion";
import TourPhone from "../TourPhone";
import { textContainerVariants, textItemVariants, featureCardVariants } from "../animations";

// This would use a wizard screenshot - using placeholder for now
const WIZARD_SCREENSHOT = "/screenshots/trip-barcelona-hero.png";

export default function SlideDestination() {
  return (
    <div className="relative w-full h-full flex items-center justify-center px-3 md:px-8">
      <div className="w-full max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-8 lg:gap-16 items-center">
        {/* Phone Mockup - Shows first on mobile */}
        <div className="order-1 lg:order-2 flex justify-center">
          <TourPhone
            screenImage={WIZARD_SCREENSHOT}
            variant="right"
            size="lg"
            delay={0.2}
            showSpotlight
            spotlightPosition={{
              top: "8%",
              left: "4%",
              width: "92%",
              height: "18%",
            }}
          />
        </div>

        {/* Text Content - Compact on mobile */}
        <motion.div
          variants={textContainerVariants}
          initial="hidden"
          animate="visible"
          className="order-2 lg:order-1 text-center lg:text-left"
        >
          {/* Slide indicator - smaller on mobile */}
          <motion.div
            variants={textItemVariants}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/20 backdrop-blur-md border border-white/10 mb-3 md:mb-6"
          >
            <span className="w-2 h-2 rounded-full bg-[var(--accent)]" />
            <span className="text-xs md:text-sm text-white/80 font-medium">Step 1 of 4</span>
          </motion.div>

          {/* Headline - smaller on mobile */}
          <motion.h2
            variants={textItemVariants}
            className="text-2xl md:text-4xl lg:text-5xl font-bold text-white mb-2 md:mb-4 leading-tight"
            style={{ fontFamily: "var(--font-playfair), Georgia, serif" }}
          >
            Dream Your{" "}
            <span className="text-[var(--accent)]">Destination</span>
          </motion.h2>

          {/* Description - shorter on mobile */}
          <motion.p
            variants={textItemVariants}
            className="text-sm md:text-lg text-white/70 mb-4 md:mb-8 max-w-md mx-auto lg:mx-0"
          >
            Type any place and let our AI handle the rest.
          </motion.p>

          {/* Feature highlights - hidden on very small screens */}
          <div className="hidden sm:flex flex-col gap-2 md:gap-3">
            {[
              { icon: "🌍", text: "180+ destinations" },
              { icon: "⚡", text: "Instant suggestions" },
              { icon: "🎯", text: "Works with vague ideas" },
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
            <span>🌍 180+ places</span>
            <span>⚡ Instant</span>
            <span>🎯 Smart</span>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
