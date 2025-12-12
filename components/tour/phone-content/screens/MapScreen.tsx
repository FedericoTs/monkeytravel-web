"use client";

import { motion, Variants } from "framer-motion";

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.15,
      delayChildren: 0.3,
    },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4 },
  },
};

// Animated map pin
function MapPin({
  x,
  y,
  number,
  color,
  label,
  delay,
}: {
  x: number;
  y: number;
  number: number;
  color: string;
  label: string;
  delay: number;
}) {
  return (
    <motion.div
      className="absolute"
      style={{ left: `${x}%`, top: `${y}%` }}
      initial={{ opacity: 0, y: -30, scale: 0 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        type: "spring",
        stiffness: 300,
        damping: 15,
        delay,
      }}
    >
      {/* Pin */}
      <motion.div
        className="relative"
        animate={{ y: [0, -3, 0] }}
        transition={{ duration: 2, repeat: Infinity, delay: delay + 0.5 }}
      >
        <div
          className="w-5 h-5 md:w-6 md:h-6 rounded-full flex items-center justify-center text-[7px] md:text-[8px] font-bold shadow-lg"
          style={{ backgroundColor: color, color: number === 3 ? "#1a1a1a" : "#fff" }}
        >
          {number}
        </div>
        {/* Pin point */}
        <div
          className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[4px] border-r-[4px] border-t-[6px] border-l-transparent border-r-transparent"
          style={{ borderTopColor: color }}
        />
      </motion.div>

      {/* Label */}
      <motion.div
        className="absolute top-full left-1/2 -translate-x-1/2 mt-1 whitespace-nowrap"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: delay + 0.3 }}
      >
        <div className="px-1.5 py-0.5 rounded bg-white/90 shadow-sm text-[6px] md:text-[7px] text-gray-700 font-medium">
          {label}
        </div>
      </motion.div>

      {/* Shadow under pin */}
      <div
        className="absolute top-5 left-1/2 -translate-x-1/2 w-3 h-1 rounded-full bg-black/20 blur-[2px]"
      />
    </motion.div>
  );
}

export default function MapScreen() {
  return (
    <motion.div
      className="absolute inset-0 flex flex-col"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Status bar area */}
      <div className="h-[10%] bg-[#FFFAF5]" />

      {/* Header */}
      <motion.div
        variants={itemVariants}
        className="px-3 py-2 bg-[#FFFAF5] border-b border-gray-100"
      >
        <h1 className="text-[12px] md:text-[14px] font-bold text-gray-900 text-center">
          Barcelona
        </h1>
        <p className="text-[8px] md:text-[9px] text-gray-500 text-center">Day 1 Route</p>
      </motion.div>

      {/* Map area */}
      <div className="flex-1 relative overflow-hidden">
        {/* Map background gradient */}
        <div
          className="absolute inset-0"
          style={{
            background: `
              linear-gradient(180deg, #e8f0f8 0%, #d8e8e4 30%, #e4dcd0 70%, #f0e8dc 100%),
              repeating-linear-gradient(0deg, transparent, transparent 12px, rgba(0,0,0,0.015) 12px, rgba(0,0,0,0.015) 13px),
              repeating-linear-gradient(90deg, transparent, transparent 12px, rgba(0,0,0,0.015) 12px, rgba(0,0,0,0.015) 13px)
            `,
          }}
        />

        {/* Water area (Mediterranean) */}
        <div
          className="absolute bottom-0 right-0 w-1/3 h-1/4"
          style={{
            background: "linear-gradient(135deg, rgba(116, 185, 255, 0.3) 0%, rgba(116, 185, 255, 0.15) 100%)",
            borderTopLeftRadius: "50%",
          }}
        />

        {/* Major roads */}
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100">
          {/* La Rambla (main street) */}
          <motion.path
            d="M 35 15 L 35 85"
            stroke="rgba(0,0,0,0.08)"
            strokeWidth="3"
            fill="none"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.5, delay: 0.5 }}
          />
          {/* Via Laietana */}
          <motion.path
            d="M 55 10 L 60 90"
            stroke="rgba(0,0,0,0.08)"
            strokeWidth="2.5"
            fill="none"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.5, delay: 0.7 }}
          />
          {/* Horizontal street */}
          <motion.path
            d="M 10 50 L 90 50"
            stroke="rgba(0,0,0,0.06)"
            strokeWidth="2"
            fill="none"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.5, delay: 0.9 }}
          />
        </svg>

        {/* Route path between pins */}
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100">
          <motion.path
            d="M 28 28 Q 35 35 42 42 T 58 58 Q 65 62 72 68"
            stroke="var(--primary)"
            strokeWidth="2"
            strokeDasharray="4 2"
            fill="none"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 2, delay: 1.5 }}
          />
        </svg>

        {/* Map pins */}
        <MapPin
          x={25}
          y={25}
          number={1}
          color="var(--primary)"
          label="Cathedral"
          delay={0.8}
        />
        <MapPin
          x={45}
          y={45}
          number={2}
          color="var(--secondary)"
          label="Can Culleretes"
          delay={1.1}
        />
        <MapPin
          x={70}
          y={65}
          number={3}
          color="var(--accent)"
          label="Picasso Museum"
          delay={1.4}
        />

        {/* Compass */}
        <motion.div
          className="absolute top-3 right-3"
          variants={itemVariants}
        >
          <div className="w-8 h-8 rounded-full bg-white/90 shadow-lg flex items-center justify-center">
            <div className="text-[10px]">🧭</div>
          </div>
        </motion.div>

        {/* Zoom controls */}
        <motion.div
          className="absolute bottom-20 right-3 flex flex-col gap-1"
          variants={itemVariants}
        >
          <button className="w-6 h-6 rounded-lg bg-white/90 shadow-sm flex items-center justify-center text-gray-600 text-[12px]">
            +
          </button>
          <button className="w-6 h-6 rounded-lg bg-white/90 shadow-sm flex items-center justify-center text-gray-600 text-[12px]">
            −
          </button>
        </motion.div>
      </div>

      {/* Route summary */}
      <motion.div
        variants={itemVariants}
        className="px-3 py-2 bg-white border-t border-gray-100"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[10px]">📍</span>
            <span className="text-[9px] md:text-[10px] font-medium text-gray-900">3 locations</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px]">🚶</span>
            <span className="text-[9px] md:text-[10px] text-gray-600">~45 min walk</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px]">📏</span>
            <span className="text-[9px] md:text-[10px] text-gray-600">~2.3 km</span>
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
