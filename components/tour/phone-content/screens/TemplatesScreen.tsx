"use client";

import { motion, Variants } from "framer-motion";

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.12,
      delayChildren: 0.3,
    },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 15 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: "easeOut" as const },
  },
};

const cardVariants: Variants = {
  hidden: { opacity: 0, scale: 0.9, y: 20 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { type: "spring", stiffness: 200, damping: 20 },
  },
};

// Template card component
function TemplateCard({
  city,
  country,
  flag,
  days,
  gradient,
  isFeatured = false,
  isHighlighted = false,
  delay = 0,
}: {
  city: string;
  country: string;
  flag: string;
  days: number;
  gradient: string;
  isFeatured?: boolean;
  isHighlighted?: boolean;
  delay?: number;
}) {
  return (
    <motion.div
      variants={cardVariants}
      className={`relative overflow-hidden ${
        isFeatured ? "rounded-2xl" : "rounded-xl"
      } ${isHighlighted ? "ring-2 ring-[var(--accent)]" : ""}`}
      style={{ aspectRatio: isFeatured ? "16/10" : "1/1" }}
      animate={
        isHighlighted
          ? {
              boxShadow: [
                "0 0 0 0 rgba(255, 217, 61, 0)",
                "0 0 15px 4px rgba(255, 217, 61, 0.4)",
                "0 0 0 0 rgba(255, 217, 61, 0)",
              ],
            }
          : {}
      }
      transition={
        isHighlighted
          ? { duration: 2, repeat: Infinity, delay: 1 }
          : { delay }
      }
    >
      {/* Gradient background (simulates image) */}
      <div className="absolute inset-0" style={{ background: gradient }} />

      {/* Overlay gradient for text readability */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />

      {/* Content */}
      <div className="absolute inset-0 p-2 flex flex-col justify-between">
        {/* Top badges */}
        <div className="flex items-center justify-between">
          {isFeatured && (
            <span className="px-1.5 py-0.5 rounded-full bg-[var(--primary)] text-white text-[6px] md:text-[7px] font-medium">
              Featured
            </span>
          )}
          <span className="px-1.5 py-0.5 rounded-full bg-white/20 backdrop-blur-sm text-white text-[6px] md:text-[7px] flex items-center gap-0.5">
            📅 {days} days
          </span>
          {!isFeatured && <div />}
          <span className="px-1.5 py-0.5 rounded-full bg-white/20 backdrop-blur-sm text-white text-[7px]">
            €€
          </span>
        </div>

        {/* Bottom info */}
        <div>
          <div className="flex items-center gap-1 mb-0.5">
            <span className="text-white/70 text-[7px] md:text-[8px]">{flag}</span>
            <span className="text-white/70 text-[7px] md:text-[8px] uppercase tracking-wide">
              {country}
            </span>
          </div>
          <h3 className="text-white font-bold text-[12px] md:text-[14px] leading-tight mb-1">
            {city}
          </h3>
          {isFeatured && (
            <motion.button
              className="px-2 py-0.5 rounded-full bg-[var(--accent)] text-gray-900 text-[7px] md:text-[8px] font-medium flex items-center gap-1"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              Explore Itinerary
              <span>→</span>
            </motion.button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export default function TemplatesScreen() {
  return (
    <motion.div
      className="absolute inset-0 flex flex-col bg-[#FFFAF5]"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Status bar area */}
      <div className="h-[10%]" />

      {/* Header */}
      <motion.div
        variants={itemVariants}
        className="flex items-center justify-center gap-1.5 px-3 py-2"
      >
        <motion.span
          className="text-[12px]"
          animate={{ rotate: [0, 10, -10, 0] }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          ✨
        </motion.span>
        <h1 className="text-[13px] md:text-[15px] font-bold text-gray-900">
          Curated Escapes
        </h1>
      </motion.div>

      {/* Search bar */}
      <motion.div variants={itemVariants} className="px-3 mb-3">
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-xl bg-gray-100 border border-gray-200">
          <span className="text-gray-400 text-[10px]">🔍</span>
          <span className="text-[8px] md:text-[9px] text-gray-400">Search destinations...</span>
          <div className="ml-auto w-5 h-5 rounded-lg bg-white flex items-center justify-center shadow-sm">
            <span className="text-[8px]">⚙️</span>
          </div>
        </div>
      </motion.div>

      {/* Featured template (Paris) - HIGHLIGHTED */}
      <motion.div variants={itemVariants} className="px-3 mb-2">
        <TemplateCard
          city="Paris"
          country="France"
          flag="🇫🇷"
          days={7}
          gradient="linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%)"
          isFeatured
          isHighlighted
        />
      </motion.div>

      {/* Section label */}
      <motion.div
        variants={itemVariants}
        className="flex items-center justify-between px-3 mb-2"
      >
        <span className="text-[8px] md:text-[9px] text-gray-600">5 more curated escapes</span>
        <span className="text-[7px] md:text-[8px] text-gray-400 flex items-center gap-0.5">
          <span>🤝</span> Hand-picked by experts
        </span>
      </motion.div>

      {/* Template grid (2 columns) */}
      <motion.div
        variants={itemVariants}
        className="grid grid-cols-2 gap-2 px-3"
      >
        <TemplateCard
          city="Tokyo"
          country="Japan"
          flag="🇯🇵"
          days={7}
          gradient="linear-gradient(135deg, #ff6b6b 0%, #feca57 100%)"
          delay={0.1}
        />
        <TemplateCard
          city="Barcelona"
          country="Spain"
          flag="🇪🇸"
          days={5}
          gradient="linear-gradient(135deg, #00b894 0%, #00cec9 100%)"
          delay={0.2}
        />
      </motion.div>

      {/* Explore link */}
      <motion.div
        variants={itemVariants}
        className="flex items-center justify-center gap-1 py-2"
      >
        <span className="text-[8px] text-[var(--primary)] font-medium">Explore →</span>
      </motion.div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Bottom navigation */}
      <motion.div
        variants={itemVariants}
        className="flex items-center justify-around py-2 border-t border-gray-100 bg-white"
      >
        <div className="flex flex-col items-center gap-0.5 text-gray-400">
          <span className="text-[10px]">🏠</span>
          <span className="text-[6px]">Home</span>
        </div>
        <div className="flex flex-col items-center gap-0.5 text-gray-400">
          <span className="text-[10px]">📋</span>
          <span className="text-[6px]">My Trips</span>
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <div className="w-6 h-6 rounded-full bg-[var(--primary)] flex items-center justify-center text-white text-[10px]">
            +
          </div>
        </div>
        <div className="flex flex-col items-center gap-0.5 text-gray-400">
          <span className="text-[10px]">👤</span>
          <span className="text-[6px]">Profile</span>
        </div>
      </motion.div>
    </motion.div>
  );
}
