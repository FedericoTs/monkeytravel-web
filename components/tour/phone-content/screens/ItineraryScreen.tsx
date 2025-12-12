"use client";

import { motion, Variants } from "framer-motion";

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.2,
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
  hidden: { opacity: 0, x: -20, scale: 0.95 },
  visible: {
    opacity: 1,
    x: 0,
    scale: 1,
    transition: { type: "spring", stiffness: 200, damping: 20 },
  },
};

// Activity card component
function ActivityCard({
  time,
  duration,
  title,
  description,
  address,
  price,
  icon,
  isHighlighted = false,
  delay = 0,
}: {
  time: string;
  duration: string;
  title: string;
  description: string;
  address: string;
  price: string;
  icon: string;
  isHighlighted?: boolean;
  delay?: number;
}) {
  return (
    <motion.div
      variants={cardVariants}
      className={`bg-white rounded-xl p-2 shadow-sm border ${
        isHighlighted ? "border-[var(--accent)]" : "border-gray-100"
      }`}
      animate={
        isHighlighted
          ? {
              boxShadow: [
                "0 0 0 0 rgba(255, 217, 61, 0)",
                "0 0 12px 3px rgba(255, 217, 61, 0.4)",
                "0 0 0 0 rgba(255, 217, 61, 0)",
              ],
              borderColor: [
                "rgba(255, 217, 61, 0.5)",
                "rgba(255, 217, 61, 1)",
                "rgba(255, 217, 61, 0.5)",
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
      {/* Time and duration */}
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[9px] md:text-[10px]">{icon}</span>
        <span className="text-[8px] md:text-[9px] font-medium text-gray-900">{time}</span>
        <span className="text-[7px] md:text-[8px] text-gray-400">· {duration}</span>
      </div>

      {/* Title */}
      <h3 className="text-[9px] md:text-[11px] font-semibold text-gray-900 mb-0.5">{title}</h3>

      {/* Description */}
      <p className="text-[7px] md:text-[8px] text-gray-500 line-clamp-2 mb-1">{description}</p>

      {/* Address */}
      <div className="flex items-center gap-1 text-[7px] md:text-[8px] text-gray-400 mb-1">
        <span>📍</span>
        <span className="truncate">{address}</span>
      </div>

      {/* Price */}
      <div className="text-[8px] md:text-[9px] text-gray-600 mb-1.5">~{price}</div>

      {/* Action buttons */}
      <div className="flex items-center gap-1">
        <button className="px-1.5 py-0.5 rounded-lg bg-gray-100 text-[7px] text-gray-600 flex items-center gap-0.5">
          <span>📍</span> Maps
        </button>
        <button className="px-1.5 py-0.5 rounded-lg bg-gray-100 text-[7px] text-gray-600 flex items-center gap-0.5">
          <span>🔍</span> Verify
        </button>
        <button className="px-1.5 py-0.5 rounded-lg bg-[var(--primary)]/10 text-[7px] text-[var(--primary)] flex items-center gap-0.5">
          <span>🌐</span> Website
        </button>
      </div>
    </motion.div>
  );
}

// Walking badge component
function WalkingBadge({ time, distance }: { time: string; distance: string }) {
  return (
    <motion.div
      variants={itemVariants}
      className="flex items-center justify-center py-1"
    >
      <div className="relative flex items-center">
        {/* Vertical line */}
        <div className="absolute left-1/2 -translate-x-1/2 h-full w-px bg-gray-200" />

        {/* Dot */}
        <motion.div
          className="w-1.5 h-1.5 rounded-full bg-[var(--secondary)] mr-1.5 relative z-10"
          animate={{ scale: [1, 1.3, 1] }}
          transition={{ duration: 2, repeat: Infinity }}
        />

        {/* Badge */}
        <motion.div
          className="px-2 py-0.5 rounded-full bg-[var(--secondary)]/10 border border-[var(--secondary)]/30 flex items-center gap-1"
          animate={{
            boxShadow: [
              "0 0 0 0 rgba(0, 180, 166, 0)",
              "0 0 8px 2px rgba(0, 180, 166, 0.3)",
              "0 0 0 0 rgba(0, 180, 166, 0)",
            ],
          }}
          transition={{ duration: 2, repeat: Infinity, delay: 0.5 }}
        >
          <span className="text-[8px]">🚶</span>
          <span className="text-[7px] md:text-[8px] text-[var(--secondary)] font-medium">~{time}</span>
          <span className="text-[6px] md:text-[7px] text-gray-400">~{distance}</span>
        </motion.div>
      </div>
    </motion.div>
  );
}

export default function ItineraryScreen() {
  return (
    <motion.div
      className="absolute inset-0 flex flex-col text-[8px] md:text-[10px] bg-gray-50"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Status bar area */}
      <div className="h-[10%] bg-white" />

      {/* Day tabs */}
      <motion.div
        variants={itemVariants}
        className="flex items-center gap-1 px-2 py-1.5 bg-white border-b border-gray-100"
      >
        {["All", "Day 1", "Day 2", "Day 3"].map((tab, index) => (
          <motion.button
            key={tab}
            className={`px-2 py-0.5 rounded-full text-[8px] md:text-[9px] font-medium ${
              index === 1
                ? "bg-[var(--primary)] text-white"
                : "text-gray-500 hover:bg-gray-100"
            }`}
            whileTap={{ scale: 0.95 }}
          >
            {tab}
          </motion.button>
        ))}
      </motion.div>

      {/* Day header */}
      <motion.div variants={itemVariants} className="flex items-center gap-2 px-3 py-2">
        <div className="w-6 h-6 md:w-7 md:h-7 rounded-full bg-[var(--primary)] text-white flex items-center justify-center text-[10px] md:text-[12px] font-bold">
          1
        </div>
        <div>
          <h2 className="text-[10px] md:text-[12px] font-bold text-gray-900">Day 1</h2>
          <p className="text-[8px] md:text-[9px] text-gray-500">Gothic Quarter Immersion</p>
        </div>
      </motion.div>

      {/* Scrollable activity list */}
      <div className="flex-1 overflow-hidden px-2 space-y-1">
        {/* First activity - HIGHLIGHTED */}
        <ActivityCard
          icon="🏛️"
          time="09:00"
          duration="180 min"
          title="Barcelona Cathedral"
          description="Explore the stunning Gothic architecture of Barcelona Cathedral, formally known as the Cathedral of the Holy Cross..."
          address="Pla de la Seu, s/n, Ciutat Vella, 08002 Barcelona"
          price="$10"
          isHighlighted={true}
        />

        {/* Walking badge */}
        <WalkingBadge time="2 min" distance="153 m" />

        {/* Second activity */}
        <ActivityCard
          icon="🍽️"
          time="12:30"
          duration="90 min"
          title="Can Culleretes"
          description="Enjoy traditional Catalan cuisine at Can Culleretes, the oldest restaurant in Barcelona..."
          address="Carrer d'en Quintana, 5, Ciutat Vella, Barcelona"
          price="$41"
          delay={0.2}
        />

        {/* Walking badge */}
        <WalkingBadge time="1 min" distance="59 m" />

        {/* Third activity (partial) */}
        <motion.div
          variants={cardVariants}
          className="bg-white rounded-xl p-2 shadow-sm border border-gray-100 opacity-60"
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[9px]">🎨</span>
            <span className="text-[8px] font-medium text-gray-900">14:30</span>
            <span className="text-[7px] text-gray-400">· 150 min</span>
          </div>
          <h3 className="text-[9px] font-semibold text-gray-900">Picasso Museum</h3>
        </motion.div>
      </div>

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
