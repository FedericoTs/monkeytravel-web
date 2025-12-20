"use client";

import { motion } from "framer-motion";
import { PhoneScreen, LiveMapScreen } from "../phone-content";
import { textContainerVariants, textItemVariants, featureCardVariants } from "../animations";

export default function SlideMap() {
  return (
    <div className="relative w-full h-full flex items-center justify-center px-3 md:px-8">
      <div className="w-full max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-8 lg:gap-16 items-center">
        {/* Phone Mockup - Live Map */}
        <div className="order-1 flex justify-center">
          <PhoneScreen variant="left" size="lg" delay={0.2}>
            <LiveMapScreen />
          </PhoneScreen>
        </div>

        {/* Text Content */}
        <motion.div
          variants={textContainerVariants}
          initial="hidden"
          animate="visible"
          className="order-2 text-center lg:text-left"
        >
          {/* Slide indicator */}
          <motion.div
            variants={textItemVariants}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#9B59B6]/10 border border-[#9B59B6]/20 mb-3 md:mb-6"
          >
            <span className="w-2 h-2 rounded-full bg-[#9B59B6]" />
            <span className="text-xs md:text-sm text-gray-600 font-medium">Step 3 of 5</span>
          </motion.div>

          {/* Headline */}
          <motion.h2
            variants={textItemVariants}
            className="text-2xl md:text-4xl lg:text-5xl font-bold text-gray-900 mb-2 md:mb-4 leading-tight"
            style={{ fontFamily: "var(--font-playfair), Georgia, serif" }}
          >
            Navigate{" "}
            <span className="text-[#9B59B6]">Your Adventure</span>
          </motion.h2>

          {/* Description */}
          <motion.p
            variants={textItemVariants}
            className="text-sm md:text-lg text-gray-600 mb-4 md:mb-8 max-w-md mx-auto lg:mx-0"
          >
            Live maps, walking routes, and real-time updates keep you on track during your trip.
          </motion.p>

          {/* Feature highlights */}
          <div className="hidden sm:flex flex-col gap-2 md:gap-3">
            {[
              { icon: "🗺️", text: "Live route tracking" },
              { icon: "🚶", text: "Walking directions" },
              { icon: "📊", text: "Trip budget tracker" },
            ].map((feature, index) => (
              <motion.div
                key={index}
                variants={featureCardVariants}
                custom={index}
                initial="hidden"
                animate="visible"
                className="flex items-center gap-3 bg-white/80 backdrop-blur-sm rounded-xl px-4 py-2.5 md:px-5 md:py-3.5 border border-gray-200/50 shadow-sm max-w-sm mx-auto lg:mx-0"
              >
                <span className="text-lg md:text-2xl">{feature.icon}</span>
                <span className="text-gray-700 text-sm md:text-base font-medium">{feature.text}</span>
              </motion.div>
            ))}
          </div>

          {/* Mobile-only compact features */}
          <div className="flex sm:hidden justify-center gap-4 text-gray-500 text-xs">
            <span>🗺️ Live</span>
            <span>🚶 Walk</span>
            <span>📊 Budget</span>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
