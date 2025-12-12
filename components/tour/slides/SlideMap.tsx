"use client";

import { motion } from "framer-motion";
import { PhoneScreen, MapScreen } from "../phone-content";
import { textContainerVariants, textItemVariants, featureCardVariants } from "../animations";

export default function SlideMap() {
  return (
    <div className="relative w-full h-full flex items-center justify-center px-3 md:px-8">
      <div className="w-full max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-8 lg:gap-16 items-center">
        {/* Phone Mockup with Map */}
        <div className="order-1 lg:order-2 flex justify-center relative">
          <PhoneScreen variant="center" size="lg" delay={0.2}>
            <MapScreen />
          </PhoneScreen>
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
