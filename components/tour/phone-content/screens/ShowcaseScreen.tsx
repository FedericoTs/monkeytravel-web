"use client";

import { motion } from "framer-motion";

interface ShowcaseScreenProps {
  variant: "lisbon" | "barcelona" | "porto";
}

const DESTINATIONS = {
  lisbon: {
    name: "Lisbon Trip",
    dates: "Mar 5-12, 2026",
    duration: "8D 7N",
    activities: 15,
    budget: "$580",
    tags: ["foodie", "culture", "beach"],
    color: "#FFD93D", // Gold
  },
  barcelona: {
    name: "Barcelona Trip",
    dates: "Feb 12-21, 2026",
    duration: "10D 9N",
    activities: 12,
    budget: "$442",
    tags: ["culture", "history", "art"],
    color: "#FF6B6B", // Coral
  },
  porto: {
    name: "Porto Trip",
    dates: "Apr 1-7, 2026",
    duration: "7D 6N",
    activities: 10,
    budget: "$320",
    tags: ["wine", "architecture", "river"],
    color: "#00B4A6", // Teal
  },
};

export default function ShowcaseScreen({ variant }: ShowcaseScreenProps) {
  const dest = DESTINATIONS[variant];

  return (
    <motion.div
      className="absolute inset-0 flex flex-col text-[6px] md:text-[8px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      {/* Status bar area */}
      <div className="h-[12%]" />

      {/* Header */}
      <div className="flex items-center justify-between px-2 mb-1">
        <div className="flex items-center gap-0.5 text-gray-400 text-[5px]">
          <span>←</span>
          <span>Back</span>
        </div>
        <div
          className="px-1 py-0.5 rounded-full text-[5px] font-medium"
          style={{ backgroundColor: `${dest.color}20`, color: dest.color }}
        >
          Shared
        </div>
      </div>

      {/* Title */}
      <div className="px-2 mb-1">
        <h1 className="text-[10px] md:text-[12px] font-bold text-gray-900 leading-tight">
          {dest.name}
        </h1>
        <p className="text-gray-400 text-[5px] md:text-[6px] line-clamp-1">
          A beautiful destination...
        </p>
      </div>

      {/* Info row */}
      <div className="flex items-center gap-1 px-2 mb-1 flex-wrap">
        <span className="text-gray-500 text-[5px]">📅 {dest.dates}</span>
        <span className="text-gray-500 text-[5px]">🎯 {dest.activities}</span>
        <motion.span
          className="px-1 py-0.5 rounded-full bg-green-100 text-green-700 text-[5px] font-medium"
          animate={{ scale: [1, 1.05, 1] }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          {dest.budget}
        </motion.span>
      </div>

      {/* Tags */}
      <div className="flex items-center gap-1 px-2 mb-2">
        {dest.tags.map((tag) => (
          <span
            key={tag}
            className="px-1 py-0.5 rounded-full border border-gray-200 text-gray-600 text-[4px] md:text-[5px] capitalize"
          >
            {tag}
          </span>
        ))}
      </div>

      {/* Map preview */}
      <div className="flex-1 px-2 mb-1">
        <div
          className="relative w-full h-full rounded-lg overflow-hidden"
          style={{
            background: `linear-gradient(135deg, ${dest.color}15 0%, ${dest.color}05 100%)`,
          }}
        >
          {/* Simple map lines */}
          <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100">
            <path
              d="M 10 50 Q 30 30 50 50 T 90 50"
              stroke={`${dest.color}40`}
              strokeWidth="2"
              fill="none"
            />
            <path
              d="M 20 30 L 80 70"
              stroke={`${dest.color}20`}
              strokeWidth="1"
              fill="none"
            />
          </svg>

          {/* Pins */}
          <motion.div
            className="absolute w-3 h-3 rounded-full flex items-center justify-center text-[5px] font-bold text-white shadow"
            style={{ backgroundColor: dest.color, left: "25%", top: "35%" }}
            animate={{ y: [0, -2, 0] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            1
          </motion.div>
          <motion.div
            className="absolute w-3 h-3 rounded-full flex items-center justify-center text-[5px] font-bold text-white shadow"
            style={{ backgroundColor: dest.color, left: "60%", top: "55%" }}
            animate={{ y: [0, -2, 0] }}
            transition={{ duration: 2, repeat: Infinity, delay: 0.3 }}
          >
            2
          </motion.div>
        </div>
      </div>

      {/* Bottom nav */}
      <div className="flex items-center justify-around py-1.5 border-t border-gray-100 bg-white">
        <span className="text-[8px] text-gray-400">🏠</span>
        <span className="text-[8px]" style={{ color: dest.color }}>
          📋
        </span>
        <div
          className="w-4 h-4 rounded-full flex items-center justify-center text-white text-[8px]"
          style={{ backgroundColor: dest.color }}
        >
          +
        </div>
        <span className="text-[8px] text-gray-400">👤</span>
      </div>
    </motion.div>
  );
}
