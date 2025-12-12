"use client";

import { motion } from "framer-motion";
import { CascadePhoneScreen, CTAShowcaseScreen } from "../phone-content";
import { textContainerVariants, textItemVariants, ctaPulseVariants } from "../animations";

// Cascade phone variants - code-rendered, no images needed
const CASCADE_VARIANTS: Array<"lisbon" | "barcelona" | "porto"> = [
  "lisbon",
  "barcelona",
  "porto",
];

interface SlideCTAProps {
  onStartPlanning: () => void;
  onSignIn: () => void;
}

export default function SlideCTA({ onStartPlanning, onSignIn }: SlideCTAProps) {
  return (
    <div className="relative w-full h-full flex items-center justify-center px-3 md:px-8">
      <div className="w-full max-w-4xl mx-auto flex flex-col items-center">
        {/* Phone Cascade - Code rendered */}
        <div className="relative flex items-end justify-center mb-4 md:mb-10">
          {CASCADE_VARIANTS.map((variant, index) => (
            <div
              key={variant}
              className={`${index === 1 ? "relative z-10" : "relative z-5"} ${
                index === 0 ? "-mr-6 md:-mr-10" : index === 2 ? "-ml-6 md:-ml-10" : ""
              }`}
            >
              <CascadePhoneScreen index={index}>
                <CTAShowcaseScreen variant={variant} />
              </CascadePhoneScreen>
            </div>
          ))}
        </div>

        {/* Text Content - Compact */}
        <motion.div
          variants={textContainerVariants}
          initial="hidden"
          animate="visible"
          className="text-center max-w-xl"
        >
          {/* Headline */}
          <motion.h2
            variants={textItemVariants}
            className="text-2xl md:text-4xl lg:text-5xl font-bold text-gray-900 mb-2 md:mb-4 leading-tight"
            style={{ fontFamily: "var(--font-playfair), Georgia, serif" }}
          >
            Your Adventure{" "}
            <span className="text-[#FF6B6B]">Awaits</span>
          </motion.h2>

          {/* Description */}
          <motion.p
            variants={textItemVariants}
            className="text-sm md:text-lg text-gray-600 mb-4 md:mb-8"
          >
            Join thousands of travelers planning smarter trips with AI.
          </motion.p>

          {/* CTA Buttons */}
          <motion.div
            variants={textItemVariants}
            className="flex flex-col sm:flex-row gap-3 justify-center"
          >
            {/* Primary CTA */}
            <motion.button
              onClick={onStartPlanning}
              variants={ctaPulseVariants}
              initial="initial"
              animate="animate"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.98 }}
              className="
                relative px-6 py-3 md:px-8 md:py-4 rounded-full
                bg-[#FF6B6B] text-white
                font-bold text-base md:text-lg
                shadow-lg shadow-[#FF6B6B]/30
                transition-colors
                hover:bg-[#FF5252]
              "
            >
              <span className="relative z-10 flex items-center justify-center gap-2">
                <span>Start Planning Free</span>
                <svg className="w-4 h-4 md:w-5 md:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </span>
            </motion.button>

            {/* Secondary CTA */}
            <motion.button
              onClick={onSignIn}
              whileHover={{ scale: 1.02, backgroundColor: "rgba(0, 0, 0, 0.08)" }}
              whileTap={{ scale: 0.98 }}
              className="
                px-6 py-3 md:px-8 md:py-4 rounded-full
                bg-white/80 text-gray-700
                font-semibold text-base md:text-lg
                border border-gray-200
                backdrop-blur-sm
                transition-colors
              "
            >
              I Have an Account
            </motion.button>
          </motion.div>

          {/* Trust indicators - Compact on mobile */}
          <motion.div
            variants={textItemVariants}
            className="mt-4 md:mt-8 flex flex-wrap items-center justify-center gap-2 md:gap-4"
          >
            {[
              "No credit card",
              "Free AI trip",
              "Cancel anytime"
            ].map((text, i) => (
              <div key={i} className="flex items-center gap-1.5 px-2 py-1 md:px-3 md:py-1.5 rounded-full bg-white/80 border border-gray-200/50 backdrop-blur-sm">
                <svg className="w-3 h-3 md:w-4 md:h-4 text-[#00B4A6]" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span className="text-gray-600 text-xs md:text-sm font-medium">{text}</span>
              </div>
            ))}
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}
