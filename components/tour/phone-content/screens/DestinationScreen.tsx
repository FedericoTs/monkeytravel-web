"use client";

import { motion, Variants } from "framer-motion";

// Stagger children animations
const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.3,
    },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: "easeOut" as const },
  },
};

const tagVariants: Variants = {
  hidden: { opacity: 0, scale: 0.8 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { type: "spring", stiffness: 300, damping: 20 },
  },
};

const mapPinVariants: Variants = {
  hidden: { opacity: 0, y: -20, scale: 0 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: "spring", stiffness: 400, damping: 15 },
  },
};

export default function DestinationScreen() {
  return (
    <motion.div
      className="absolute inset-0 flex flex-col text-[8px] md:text-[10px]"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Status bar area (under dynamic island) */}
      <div className="h-[12%]" />

      {/* Header */}
      <motion.div
        variants={itemVariants}
        className="flex items-center justify-between px-3 mb-2"
      >
        <div className="flex items-center gap-1 text-gray-500">
          <svg className="w-2 h-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          <span>Back</span>
        </div>
        <div className="px-2 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)]">
          Shared Trip
        </div>
      </motion.div>

      {/* Title - with highlight glow */}
      <motion.div
        variants={itemVariants}
        className="px-3 mb-1"
      >
        <motion.h1
          className="text-[14px] md:text-[18px] font-bold text-gray-900 leading-tight"
          animate={{
            textShadow: [
              "0 0 0px rgba(255, 217, 61, 0)",
              "0 0 8px rgba(255, 217, 61, 0.4)",
              "0 0 0px rgba(255, 217, 61, 0)",
            ],
          }}
          transition={{ duration: 2, repeat: Infinity, delay: 1 }}
        >
          Barcelona Trip
        </motion.h1>
        <p className="text-gray-500 mt-0.5 line-clamp-2">
          A vibrant city known for its art, architecture, and Catalan culture...
        </p>
      </motion.div>

      {/* Info row */}
      <motion.div
        variants={itemVariants}
        className="flex items-center gap-2 px-3 mb-2 flex-wrap"
      >
        <div className="flex items-center gap-0.5 text-gray-600">
          <span>📅</span>
          <span>Feb 12-21, 2026</span>
        </div>
        <div className="flex items-center gap-0.5 text-gray-600">
          <span>🌡️</span>
          <span>10D 9N</span>
        </div>
        <div className="flex items-center gap-0.5 text-gray-600">
          <span>🎯</span>
          <span>12 activities</span>
        </div>
        <motion.div
          className="px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 font-medium"
          animate={{ scale: [1, 1.05, 1] }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          $442
        </motion.div>
      </motion.div>

      {/* Temperature */}
      <motion.div variants={itemVariants} className="px-3 mb-2">
        <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
          <span>🌡️</span>
          <span>0-10°C</span>
        </div>
      </motion.div>

      {/* Tags - animated highlight */}
      <motion.div
        variants={itemVariants}
        className="flex items-center gap-1.5 px-3 mb-3"
      >
        {["culture", "history", "art"].map((tag, index) => (
          <motion.span
            key={tag}
            variants={tagVariants}
            custom={index}
            className="px-2 py-0.5 rounded-full border border-gray-300 text-gray-700 capitalize"
            whileHover={{ scale: 1.05 }}
            animate={
              index === 0
                ? {
                    borderColor: ["rgba(255, 217, 61, 0.3)", "rgba(255, 217, 61, 0.8)", "rgba(255, 217, 61, 0.3)"],
                    boxShadow: [
                      "0 0 0 0 rgba(255, 217, 61, 0)",
                      "0 0 8px 2px rgba(255, 217, 61, 0.3)",
                      "0 0 0 0 rgba(255, 217, 61, 0)",
                    ],
                  }
                : {}
            }
            transition={{ duration: 2, repeat: Infinity, delay: 1.5 }}
          >
            {tag}
          </motion.span>
        ))}
      </motion.div>

      {/* Map preview */}
      <motion.div variants={itemVariants} className="flex-1 px-3 mb-2">
        <div className="relative w-full h-full rounded-xl overflow-hidden bg-gradient-to-br from-blue-50 via-green-50 to-yellow-50">
          {/* Map gradient background */}
          <div
            className="absolute inset-0"
            style={{
              background: `
                linear-gradient(135deg, #e8f4f8 0%, #d4e8e0 50%, #f0e6d3 100%),
                repeating-linear-gradient(0deg, transparent, transparent 8px, rgba(0,0,0,0.02) 8px, rgba(0,0,0,0.02) 9px),
                repeating-linear-gradient(90deg, transparent, transparent 8px, rgba(0,0,0,0.02) 8px, rgba(0,0,0,0.02) 9px)
              `,
            }}
          />

          {/* Map roads (simplified) */}
          <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100">
            <path
              d="M 10 30 Q 30 20 50 35 T 90 25"
              stroke="rgba(0,0,0,0.1)"
              strokeWidth="2"
              fill="none"
            />
            <path
              d="M 20 70 Q 40 60 60 75 T 95 65"
              stroke="rgba(0,0,0,0.1)"
              strokeWidth="2"
              fill="none"
            />
            <path
              d="M 5 50 L 95 50"
              stroke="rgba(0,0,0,0.08)"
              strokeWidth="3"
              fill="none"
            />
          </svg>

          {/* Animated pins */}
          <motion.div
            className="absolute"
            style={{ left: "20%", top: "30%" }}
            variants={mapPinVariants}
            custom={0}
          >
            <div className="w-4 h-4 md:w-5 md:h-5 rounded-full bg-[var(--primary)] text-white flex items-center justify-center text-[6px] font-bold shadow-lg">
              1
            </div>
          </motion.div>

          <motion.div
            className="absolute"
            style={{ left: "50%", top: "45%" }}
            variants={mapPinVariants}
            custom={1}
          >
            <div className="w-4 h-4 md:w-5 md:h-5 rounded-full bg-[var(--secondary)] text-white flex items-center justify-center text-[6px] font-bold shadow-lg">
              2
            </div>
          </motion.div>

          <motion.div
            className="absolute"
            style={{ left: "75%", top: "60%" }}
            variants={mapPinVariants}
            custom={2}
          >
            <div className="w-4 h-4 md:w-5 md:h-5 rounded-full bg-[var(--accent)] text-gray-900 flex items-center justify-center text-[6px] font-bold shadow-lg">
              3
            </div>
          </motion.div>

          {/* Export button */}
          <div className="absolute top-2 right-2 flex items-center gap-1">
            <div className="w-5 h-5 rounded-lg bg-white/80 backdrop-blur flex items-center justify-center shadow-sm">
              <span className="text-[8px]">📍</span>
            </div>
            <div className="px-1.5 py-0.5 rounded-lg bg-white/80 backdrop-blur text-[7px] shadow-sm">
              Export
            </div>
          </div>

          {/* Day selector dots */}
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1">
            {[1, 2, 3].map((day) => (
              <div
                key={day}
                className={`w-4 h-4 rounded-full flex items-center justify-center text-[6px] font-medium ${
                  day === 1
                    ? "bg-[var(--primary)] text-white"
                    : day === 2
                    ? "bg-[var(--secondary)] text-white"
                    : "bg-[var(--accent)] text-gray-900"
                }`}
              >
                {day}
              </div>
            ))}
          </div>
        </div>
      </motion.div>

      {/* Bottom navigation */}
      <motion.div
        variants={itemVariants}
        className="flex items-center justify-around py-2 border-t border-gray-100 bg-white"
      >
        <div className="flex flex-col items-center gap-0.5 text-gray-400">
          <span className="text-[10px]">🏠</span>
          <span className="text-[6px]">Home</span>
        </div>
        <div className="flex flex-col items-center gap-0.5 text-[var(--primary)]">
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
