"use client";

import { motion } from "framer-motion";
import TourPhone from "../TourPhone";
import { textContainerVariants, textItemVariants, featureCardVariants, GENTLE_SPRING } from "../animations";

const TEMPLATES_SCREENSHOT = "/screenshots/templates.png";

const MOOD_CHIPS = [
  { label: "Romantic", emoji: "💕" },
  { label: "Adventure", emoji: "🏔️" },
  { label: "Cultural", emoji: "🏛️" },
  { label: "Foodie", emoji: "🍝" },
  { label: "Relaxation", emoji: "🌴" },
];

export default function SlideTemplates() {
  return (
    <div className="relative w-full h-full flex items-center justify-center px-4 md:px-8">
      <div className="w-full max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-16 items-center">
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
            <span className="text-sm text-white/80 font-medium">Step 4 of 4</span>
          </motion.div>

          {/* Headline */}
          <motion.h2
            variants={textItemVariants}
            className="text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-4 leading-tight"
            style={{ fontFamily: "var(--font-playfair), Georgia, serif" }}
          >
            Start with
            <br />
            <span className="text-[var(--accent)]">Inspiration</span>
          </motion.h2>

          {/* Description */}
          <motion.p
            variants={textItemVariants}
            className="text-lg md:text-xl text-white/80 mb-6 max-w-md mx-auto lg:mx-0"
          >
            Not sure where to go? Browse curated trip templates by mood, destination, and budget.
          </motion.p>

          {/* Mood chips */}
          <motion.div
            variants={textItemVariants}
            className="flex flex-wrap gap-2 justify-center lg:justify-start mb-8"
          >
            {MOOD_CHIPS.map((chip, index) => (
              <motion.span
                key={chip.label}
                initial={{ opacity: 0, scale: 0.8, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{
                  ...GENTLE_SPRING,
                  delay: 0.8 + index * 0.1,
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/20 backdrop-blur-sm rounded-full border border-white/20 text-white text-sm font-medium"
                whileHover={{ scale: 1.05, backgroundColor: "rgba(255, 255, 255, 0.3)" }}
              >
                <span>{chip.emoji}</span>
                <span>{chip.label}</span>
              </motion.span>
            ))}
          </motion.div>

          {/* Feature highlights */}
          <div className="space-y-4">
            {[
              { icon: "✨", text: "Expert-curated trips" },
              { icon: "🎨", text: "Filter by mood & style" },
              { icon: "📋", text: "Copy & customize instantly" },
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

        {/* Phone Mockup with Templates */}
        <div className="order-1 lg:order-2 flex justify-center relative">
          <TourPhone
            screenImage={TEMPLATES_SCREENSHOT}
            variant="right"
            size="lg"
            delay={0.2}
          >
            {/* Template card highlights */}
            <TemplateHighlights />
          </TourPhone>
        </div>
      </div>
    </div>
  );
}

// Animated template card highlights
function TemplateHighlights() {
  const cards = [
    { top: "28%", left: "6%", width: "42%", height: "28%", delay: 1.0 },
    { top: "28%", left: "52%", width: "42%", height: "28%", delay: 1.3 },
    { top: "58%", left: "6%", width: "42%", height: "28%", delay: 1.6 },
  ];

  return (
    <>
      {cards.map((card, index) => (
        <motion.div
          key={index}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{
            opacity: [0, 0.8, 0.8, 0],
            scale: [0.95, 1, 1, 0.95],
          }}
          transition={{
            duration: 4,
            delay: card.delay,
            repeat: Infinity,
            repeatDelay: 3,
            times: [0, 0.1, 0.9, 1],
          }}
          className="absolute z-10 pointer-events-none rounded-xl border-2 border-white/60"
          style={{
            top: card.top,
            left: card.left,
            width: card.width,
            height: card.height,
            boxShadow: "0 0 15px 2px rgba(255, 255, 255, 0.3)",
          }}
        />
      ))}
    </>
  );
}
