"use client";

import { motion, Variants } from "framer-motion";

// Activity type configurations matching the actual app
const ACTIVITY_TYPES = {
  landmark: { color: "bg-blue-50", textColor: "text-blue-700", borderColor: "border-blue-200", icon: "🏛️" },
  restaurant: { color: "bg-orange-50", textColor: "text-orange-700", borderColor: "border-orange-200", icon: "🍽️" },
  cultural: { color: "bg-indigo-50", textColor: "text-indigo-700", borderColor: "border-indigo-200", icon: "🎭" },
  activity: { color: "bg-emerald-50", textColor: "text-emerald-700", borderColor: "border-emerald-200", icon: "🚶" },
};

interface ActivityCardProps {
  time: string;
  duration: string;
  title: string;
  location: string;
  type: keyof typeof ACTIVITY_TYPES;
  delay: number;
  isNew?: boolean;
}

function ActivityCard({ time, duration, title, location, type, delay, isNew = false }: ActivityCardProps) {
  const typeConfig = ACTIVITY_TYPES[type];

  const cardVariants: Variants = {
    hidden: {
      opacity: 0,
      x: 50,
      scale: 0.8,
    },
    visible: {
      opacity: 1,
      x: 0,
      scale: 1,
    },
  };

  return (
    <motion.div
      variants={cardVariants}
      initial="hidden"
      animate="visible"
      transition={{
        type: "spring",
        stiffness: 150,
        damping: 15,
        delay,
      }}
      className={`relative bg-white rounded-xl p-2.5 shadow-sm border border-gray-100 mb-2 ${
        isNew ? "ring-2 ring-[#FF6B6B]/50 ring-offset-1" : ""
      }`}
    >
      {/* New badge */}
      {isNew && (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: delay + 0.2, type: "spring" }}
          className="absolute -top-1.5 -right-1.5 px-1.5 py-0.5 bg-[#FF6B6B] text-white text-[7px] font-bold rounded-full"
        >
          NEW
        </motion.div>
      )}

      <div className="flex gap-2">
        {/* Time column */}
        <div className="flex flex-col items-center w-10">
          <span className="text-[10px] font-bold text-gray-900">{time}</span>
          <span className="text-[7px] text-gray-400">{duration}</span>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-1.5 mb-1">
            <span className={`px-1.5 py-0.5 rounded-md text-[7px] font-medium ${typeConfig.color} ${typeConfig.textColor} border ${typeConfig.borderColor}`}>
              {typeConfig.icon} {type}
            </span>
          </div>
          <h4 className="text-[10px] font-semibold text-gray-900 mb-0.5 truncate">{title}</h4>
          <p className="text-[8px] text-gray-500 truncate flex items-center gap-1">
            <svg className="w-2 h-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            {location}
          </p>
        </div>
      </div>
    </motion.div>
  );
}

// Loading skeleton for upcoming activities
function LoadingSkeleton({ delay }: { delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay }}
      className="bg-white rounded-xl p-2.5 shadow-sm border border-gray-100 mb-2"
    >
      <div className="flex gap-2">
        <div className="flex flex-col items-center w-10">
          <motion.div
            className="w-8 h-3 bg-gray-200 rounded"
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          />
          <motion.div
            className="w-6 h-2 bg-gray-100 rounded mt-1"
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 1.5, repeat: Infinity, delay: 0.1 }}
          />
        </div>
        <div className="flex-1">
          <motion.div
            className="w-12 h-3 bg-gray-200 rounded mb-1"
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 1.5, repeat: Infinity, delay: 0.2 }}
          />
          <motion.div
            className="w-full h-3 bg-gray-200 rounded mb-1"
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 1.5, repeat: Infinity, delay: 0.3 }}
          />
          <motion.div
            className="w-3/4 h-2 bg-gray-100 rounded"
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 1.5, repeat: Infinity, delay: 0.4 }}
          />
        </div>
      </div>
    </motion.div>
  );
}

export default function AIBuildingScreen() {
  const activities = [
    { time: "09:00", duration: "2h", title: "Sagrada Família", location: "Carrer de Mallorca", type: "landmark" as const },
    { time: "11:30", duration: "1.5h", title: "Park Güell", location: "Carrer d'Olot", type: "landmark" as const },
    { time: "13:00", duration: "1h", title: "Can Culleretes", location: "Gothic Quarter", type: "restaurant" as const },
    { time: "14:30", duration: "2h", title: "Picasso Museum", location: "Carrer Montcada", type: "cultural" as const },
  ];

  return (
    <div className="absolute inset-0 flex flex-col pt-14 pb-3 px-3">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-3"
      >
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="text-[13px] font-bold text-gray-900">Barcelona Trip</h2>
            <p className="text-[9px] text-gray-500">Feb 12 - 16, 2025 • 5 days</p>
          </div>
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: "spring" }}
            className="flex items-center gap-1 px-2 py-1 bg-[#00B4A6]/10 rounded-full"
          >
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
              className="w-2.5 h-2.5 border-2 border-[#00B4A6] border-t-transparent rounded-full"
            />
            <span className="text-[8px] font-medium text-[#00B4A6]">AI Planning</span>
          </motion.div>
        </div>

        {/* Day tabs */}
        <div className="flex gap-1 overflow-x-auto pb-1">
          {["Day 1", "Day 2", "Day 3", "Day 4", "Day 5"].map((day, i) => (
            <motion.button
              key={day}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.05 }}
              className={`px-2.5 py-1 rounded-full text-[9px] font-medium whitespace-nowrap transition-all ${
                i === 0
                  ? "bg-[#FF6B6B] text-white shadow-sm"
                  : "bg-gray-100 text-gray-600"
              }`}
            >
              {day}
            </motion.button>
          ))}
        </div>
      </motion.div>

      {/* Progress indicator */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="mb-2"
      >
        <div className="flex items-center justify-between text-[8px] text-gray-500 mb-1">
          <span>Building Day 1 itinerary...</span>
          <span className="text-[#FF6B6B] font-medium">4/6 activities</span>
        </div>
        <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: "66%" }}
            transition={{ delay: 0.5, duration: 1.5, ease: "easeOut" }}
            className="h-full bg-gradient-to-r from-[#FF6B6B] to-[#FF8E8E] rounded-full"
          />
        </div>
      </motion.div>

      {/* Activities list */}
      <div className="flex-1 overflow-hidden">
        <div className="space-y-0">
          {activities.map((activity, index) => (
            <ActivityCard
              key={activity.title}
              {...activity}
              delay={0.6 + index * 0.3}
              isNew={index === activities.length - 1}
            />
          ))}

          {/* Loading skeleton for next activity */}
          <LoadingSkeleton delay={1.8} />
        </div>
      </div>

      {/* AI insight bubble */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 2.2, type: "spring" }}
        className="mt-2 p-2 bg-gradient-to-r from-[#FF6B6B]/10 to-[#00B4A6]/10 rounded-xl border border-[#FF6B6B]/20"
      >
        <div className="flex items-start gap-2">
          <div className="w-5 h-5 rounded-full bg-gradient-to-br from-[#FF6B6B] to-[#FF8E8E] flex items-center justify-center flex-shrink-0">
            <span className="text-[8px]">💡</span>
          </div>
          <div>
            <p className="text-[8px] font-medium text-gray-700">AI Tip</p>
            <p className="text-[7px] text-gray-500">I&apos;ve optimized your route to minimize walking distance between attractions!</p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
