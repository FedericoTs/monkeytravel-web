"use client";

import { motion } from "framer-motion";
import TourPhone from "../TourPhone";
import { textContainerVariants, textItemVariants, featureCardVariants } from "../animations";

// This would use a wizard screenshot - using placeholder for now
const WIZARD_SCREENSHOT = "/screenshots/trip-barcelona-hero.png";

export default function SlideDestination() {
  return (
    <div className="relative w-full h-full flex items-center justify-center px-4 md:px-8">
      <div className="w-full max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-16 items-center">
        {/* Phone Mockup - Shows first on mobile */}
        <div className="order-1 lg:order-2 flex justify-center">
          <TourPhone
            screenImage={WIZARD_SCREENSHOT}
            variant="right"
            size="lg"
            delay={0.2}
            showSpotlight
            spotlightPosition={{
              top: "15%",
              left: "8%",
              width: "84%",
              height: "12%",
            }}
          />
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
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 mb-6"
          >
            <span className="w-2 h-2 rounded-full bg-[var(--accent)]" />
            <span className="text-sm text-white/80 font-medium">Step 1 of 4</span>
          </motion.div>

          {/* Headline */}
          <motion.h2
            variants={textItemVariants}
            className="text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-4 leading-tight"
            style={{ fontFamily: "var(--font-playfair), Georgia, serif" }}
          >
            Dream Your
            <br />
            <span className="text-[var(--accent)]">Destination</span>
          </motion.h2>

          {/* Description */}
          <motion.p
            variants={textItemVariants}
            className="text-lg md:text-xl text-white/80 mb-8 max-w-md mx-auto lg:mx-0"
          >
            Type any place — Barcelona, Tokyo, or &quot;somewhere warm&quot; — and let our AI handle the rest.
          </motion.p>

          {/* Feature highlights */}
          <div className="space-y-4">
            {[
              { icon: "🌍", text: "180+ destinations ready" },
              { icon: "⚡", text: "Instant search suggestions" },
              { icon: "🎯", text: "Works with vague ideas too" },
            ].map((feature, index) => (
              <motion.div
                key={index}
                variants={featureCardVariants}
                custom={index}
                initial="hidden"
                animate="visible"
                className="flex items-center gap-3 bg-white/10 backdrop-blur-sm rounded-xl px-4 py-3 border border-white/10 max-w-xs mx-auto lg:mx-0"
              >
                <span className="text-2xl">{feature.icon}</span>
                <span className="text-white font-medium">{feature.text}</span>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
