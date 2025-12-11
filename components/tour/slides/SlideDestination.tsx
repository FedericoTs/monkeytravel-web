"use client";

import { motion } from "framer-motion";
import TourPhone from "../TourPhone";
import { textContainerVariants, textItemVariants, featureCardVariants } from "../animations";

// This would use a wizard screenshot - using placeholder for now
const WIZARD_SCREENSHOT = "/screenshots/trip-barcelona-hero.png";

export default function SlideDestination() {
  return (
    <div className="relative w-full min-h-full flex items-center justify-center px-4 md:px-8 py-4">
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
              top: "5%",
              left: "4%",
              width: "92%",
              height: "16%",
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
            className="inline-flex items-center gap-2.5 px-4 py-2 rounded-full bg-[var(--navy)]/40 backdrop-blur-md border border-white/15 mb-6"
          >
            <span className="w-2.5 h-2.5 rounded-full bg-[var(--accent)] shadow-sm shadow-[var(--accent)]/50" />
            <span className="text-sm text-white/90 font-medium tracking-wide" style={{ fontFamily: "var(--font-source-sans), system-ui, sans-serif" }}>Step 1 of 4</span>
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
          <div className="space-y-3">
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
                className="flex items-center gap-3.5 bg-[var(--navy)]/35 backdrop-blur-md rounded-2xl px-5 py-3.5 border border-white/10 max-w-sm mx-auto lg:mx-0 hover:bg-[var(--navy)]/50 hover:border-[var(--accent)]/30 transition-all duration-300"
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
