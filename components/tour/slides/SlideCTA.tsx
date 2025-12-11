"use client";

import { motion } from "framer-motion";
import { CascadePhone } from "../TourPhone";
import { textContainerVariants, textItemVariants, ctaPulseVariants, PREMIUM_EASE } from "../animations";

// Three different screenshots for the cascade
const CASCADE_SCREENSHOTS = [
  "/screenshots/trip-lisbon-hero.png",
  "/screenshots/trip-barcelona-hero.png",
  "/screenshots/trip-porto-hero.png",
];

interface SlideCTAProps {
  onStartPlanning: () => void;
  onSignIn: () => void;
}

export default function SlideCTA({ onStartPlanning, onSignIn }: SlideCTAProps) {
  return (
    <div className="relative w-full min-h-full flex items-center justify-center px-4 md:px-8 py-4">
      <div className="w-full max-w-4xl mx-auto flex flex-col items-center">
        {/* Phone Cascade */}
        <div className="relative flex items-end justify-center gap-[-20px] mb-8 md:mb-12">
          {CASCADE_SCREENSHOTS.map((screenshot, index) => (
            <div
              key={index}
              className={`${index === 1 ? "relative z-10" : "relative z-5"} ${
                index === 0 ? "-mr-8 md:-mr-12" : index === 2 ? "-ml-8 md:-ml-12" : ""
              }`}
            >
              <CascadePhone
                screenImage={screenshot}
                index={index}
              />
            </div>
          ))}
        </div>

        {/* Text Content */}
        <motion.div
          variants={textContainerVariants}
          initial="hidden"
          animate="visible"
          className="text-center max-w-xl"
        >
          {/* Headline */}
          <motion.h2
            variants={textItemVariants}
            className="text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-4 leading-tight"
            style={{ fontFamily: "var(--font-playfair), Georgia, serif" }}
          >
            Your Adventure
            <br />
            <span className="text-[var(--accent)]">Awaits</span>
          </motion.h2>

          {/* Description */}
          <motion.p
            variants={textItemVariants}
            className="text-lg md:text-xl text-white/80 mb-8"
          >
            Join thousands of travelers planning smarter trips.
            <br className="hidden sm:block" />
            Start your first AI trip for free.
          </motion.p>

          {/* CTA Buttons */}
          <motion.div
            variants={textItemVariants}
            className="flex flex-col sm:flex-row gap-4 justify-center"
          >
            {/* Primary CTA */}
            <motion.button
              onClick={onStartPlanning}
              variants={ctaPulseVariants}
              initial="initial"
              animate="animate"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.98 }}
              className="
                relative px-8 py-4 rounded-full
                bg-[var(--accent)] text-[var(--primary-dark)]
                font-bold text-lg
                shadow-lg shadow-[var(--accent)]/30
                transition-colors
                hover:bg-[#ffe066]
              "
            >
              <span className="relative z-10 flex items-center justify-center gap-2">
                <span>Start Planning Free</span>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </span>
            </motion.button>

            {/* Secondary CTA */}
            <motion.button
              onClick={onSignIn}
              whileHover={{ scale: 1.02, backgroundColor: "rgba(255, 255, 255, 0.15)" }}
              whileTap={{ scale: 0.98 }}
              className="
                px-8 py-4 rounded-full
                bg-white/10 text-white
                font-semibold text-lg
                border border-white/30
                backdrop-blur-sm
                transition-colors
              "
            >
              I Have an Account
            </motion.button>
          </motion.div>

          {/* Trust indicators */}
          <motion.div
            variants={textItemVariants}
            className="mt-8 flex flex-wrap items-center justify-center gap-4 md:gap-6"
          >
            {[
              "No credit card required",
              "Free AI trip included",
              "Cancel anytime"
            ].map((text, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--navy)]/30 backdrop-blur-sm border border-white/10">
                <svg className="w-4 h-4 text-[var(--secondary)]" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span className="text-white/80 text-sm font-medium" style={{ fontFamily: "var(--font-source-sans), system-ui, sans-serif" }}>{text}</span>
              </div>
            ))}
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}
