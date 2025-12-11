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
];

export default function SlideTemplates() {
  return (
    <div className="relative w-full h-full flex items-center justify-center px-3 md:px-8">
      <div className="w-full max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-8 lg:gap-16 items-center">
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
            <span className="w-2 h-2 rounded-full bg-[var(--accent)]" />
            <span className="text-xs md:text-sm text-white/80 font-medium">Step 4 of 4</span>
          </motion.div>

          {/* Headline */}
          <motion.h2
            variants={textItemVariants}
            className="text-2xl md:text-4xl lg:text-5xl font-bold text-white mb-2 md:mb-4 leading-tight"
            style={{ fontFamily: "var(--font-playfair), Georgia, serif" }}
          >
            Start with{" "}
            <span className="text-[var(--accent)]">Inspiration</span>
          </motion.h2>

          {/* Description */}
          <motion.p
            variants={textItemVariants}
            className="text-sm md:text-lg text-white/70 mb-3 md:mb-6 max-w-md mx-auto lg:mx-0"
          >
            Browse curated trip templates by mood and budget.
          </motion.p>

          {/* Mood chips */}
          <motion.div
            variants={textItemVariants}
            className="flex flex-wrap gap-1.5 md:gap-2.5 justify-center lg:justify-start mb-4 md:mb-8"
          >
            {MOOD_CHIPS.map((chip, index) => (
              <motion.span
                key={chip.label}
                initial={{ opacity: 0, scale: 0.8, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{
                  ...GENTLE_SPRING,
                  delay: 0.6 + index * 0.08,
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 md:px-4 md:py-2 bg-black/15 backdrop-blur-sm rounded-full border border-white/10 text-white/80 text-xs md:text-sm font-medium"
              >
                <span>{chip.emoji}</span>
                <span>{chip.label}</span>
              </motion.span>
            ))}
          </motion.div>

          {/* Feature highlights */}
          <div className="hidden sm:flex flex-col gap-2 md:gap-3">
            {[
              { icon: "✨", text: "Expert-curated trips" },
              { icon: "🎨", text: "Filter by mood & style" },
              { icon: "📋", text: "Copy & customize" },
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
    { top: "17%", left: "4%", width: "92%", height: "32%", delay: 1.0 },
    { top: "54%", left: "4%", width: "44%", height: "26%", delay: 1.3 },
    { top: "54%", left: "52%", width: "44%", height: "26%", delay: 1.6 },
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
          className="absolute z-10 pointer-events-none rounded-lg md:rounded-xl border border-white/50 md:border-2 md:border-white/60"
          style={{
            top: card.top,
            left: card.left,
            width: card.width,
            height: card.height,
            boxShadow: "0 0 10px 1px rgba(255, 255, 255, 0.2)",
          }}
        />
      ))}
    </>
  );
}
