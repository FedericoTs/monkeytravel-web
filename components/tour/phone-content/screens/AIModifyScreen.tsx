"use client";

import { motion, Variants, AnimatePresence } from "framer-motion";
import { useState, useEffect } from "react";

// Activity type configurations
const ACTIVITY_TYPES = {
  landmark: { color: "bg-blue-50", textColor: "text-blue-700", borderColor: "border-blue-200", icon: "🏛️" },
  restaurant: { color: "bg-orange-50", textColor: "text-orange-700", borderColor: "border-orange-200", icon: "🍽️" },
  tour: { color: "bg-purple-50", textColor: "text-purple-700", borderColor: "border-purple-200", icon: "🚶" },
};

// Compact activity card for modification view
function CompactActivityCard({
  time,
  title,
  type,
  isHighlighted = false,
  isNew = false,
  isRemoving = false,
}: {
  time: string;
  title: string;
  type: keyof typeof ACTIVITY_TYPES;
  isHighlighted?: boolean;
  isNew?: boolean;
  isRemoving?: boolean;
}) {
  const typeConfig = ACTIVITY_TYPES[type];

  return (
    <motion.div
      layout
      initial={isNew ? { opacity: 0, x: 100, height: 0 } : false}
      animate={{
        opacity: isRemoving ? 0.4 : 1,
        x: 0,
        height: "auto",
        scale: isHighlighted ? 1.02 : 1,
      }}
      exit={{ opacity: 0, x: -100, height: 0 }}
      transition={{ type: "spring", stiffness: 200, damping: 20 }}
      className={`relative flex items-center gap-2 px-2 py-1.5 rounded-lg transition-all ${
        isHighlighted
          ? "bg-[#00B4A6]/10 border border-[#00B4A6]/30"
          : isRemoving
          ? "bg-red-50 border border-red-200"
          : "bg-white border border-gray-100"
      }`}
    >
      {isNew && (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="absolute -top-1 -right-1 w-4 h-4 bg-[#00B4A6] rounded-full flex items-center justify-center"
        >
          <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M5 12l5 5L20 7" />
          </svg>
        </motion.div>
      )}
      <span className="text-[9px] font-semibold text-gray-500 w-10">{time}</span>
      <span className={`${typeConfig.icon} text-[10px]`} />
      <span className={`text-[9px] font-medium ${isRemoving ? "line-through text-gray-400" : "text-gray-800"} truncate flex-1`}>
        {title}
      </span>
    </motion.div>
  );
}

// Chat message component
function ChatMessage({
  type,
  children,
  delay,
}: {
  type: "user" | "ai";
  children: React.ReactNode;
  delay: number;
}) {
  const isUser = type === "user";

  return (
    <motion.div
      initial={{ opacity: 0, y: 15, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay, type: "spring", stiffness: 200, damping: 20 }}
      className={`flex ${isUser ? "justify-end" : "justify-start"} mb-1.5`}
    >
      {!isUser && (
        <div className="w-5 h-5 rounded-full bg-gradient-to-br from-[#FF6B6B] to-[#FF8E8E] flex items-center justify-center mr-1 flex-shrink-0">
          <span className="text-[8px]">🐵</span>
        </div>
      )}
      <div
        className={`max-w-[80%] px-2.5 py-1.5 rounded-xl text-[9px] leading-relaxed ${
          isUser
            ? "bg-[#FF6B6B] text-white rounded-br-sm"
            : "bg-white text-gray-800 rounded-bl-sm shadow-sm border border-gray-100"
        }`}
      >
        {children}
      </div>
    </motion.div>
  );
}

export default function AIModifyScreen() {
  const [stage, setStage] = useState(0);

  // Auto-advance through stages for demo
  useEffect(() => {
    const timers = [
      setTimeout(() => setStage(1), 500),   // User message appears
      setTimeout(() => setStage(2), 1500),  // AI responds
      setTimeout(() => setStage(3), 2500),  // Activity gets highlighted
      setTimeout(() => setStage(4), 3000),  // New activity inserted
      setTimeout(() => setStage(5), 3800),  // Success confirmation
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  const activities = [
    { time: "09:00", title: "Sagrada Família", type: "landmark" as const },
    { time: "11:30", title: "Park Güell", type: "landmark" as const },
    { time: "13:00", title: "Can Culleretes", type: "restaurant" as const },
    { time: "15:00", title: "Gothic Quarter Walk", type: "tour" as const },
  ];

  return (
    <div className="absolute inset-0 flex flex-col pt-14 pb-3 px-3">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex items-center justify-between mb-2"
      >
        <div>
          <h2 className="text-[12px] font-bold text-gray-900">Day 1 • Barcelona</h2>
          <p className="text-[8px] text-gray-500">4 activities planned</p>
        </div>
        <motion.button
          whileHover={{ scale: 1.05 }}
          className="px-2 py-1 bg-[#FF6B6B]/10 rounded-full"
        >
          <span className="text-[8px] font-medium text-[#FF6B6B]">✨ AI Assistant</span>
        </motion.button>
      </motion.div>

      {/* Activities list */}
      <div className="bg-gray-50/80 rounded-xl p-2 mb-2 flex-1 overflow-hidden">
        <AnimatePresence mode="popLayout">
          {activities.slice(0, 2).map((activity, index) => (
            <CompactActivityCard
              key={activity.title}
              {...activity}
              isHighlighted={stage >= 3 && index === 1}
            />
          ))}

          {/* New activity inserted after Park Güell */}
          {stage >= 4 && (
            <CompactActivityCard
              key="new-food-tour"
              time="12:30"
              title="Barcelona Food Tour"
              type="tour"
              isNew
              isHighlighted
            />
          )}

          {activities.slice(2).map((activity) => (
            <CompactActivityCard
              key={activity.title}
              {...activity}
              time={stage >= 4 ? (activity.time === "13:00" ? "14:30" : "16:30") : activity.time}
            />
          ))}
        </AnimatePresence>
      </div>

      {/* Chat interaction area */}
      <div className="border-t border-gray-100 pt-2">
        {/* User request */}
        {stage >= 1 && (
          <ChatMessage type="user" delay={0}>
            Can you add a food tour after Park Güell?
          </ChatMessage>
        )}

        {/* AI response */}
        {stage >= 2 && (
          <ChatMessage type="ai" delay={0}>
            <span>Of course! 🍴 I&apos;ll add the &quot;Barcelona Food Tour&quot; at 12:30 PM, right after Park Güell...</span>
          </ChatMessage>
        )}

        {/* Success message */}
        {stage >= 5 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center justify-center gap-1.5 py-1.5"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 300 }}
              className="w-4 h-4 bg-[#00B4A6] rounded-full flex items-center justify-center"
            >
              <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <path d="M5 12l5 5L20 7" />
              </svg>
            </motion.div>
            <span className="text-[9px] font-medium text-[#00B4A6]">
              Done! I&apos;ve adjusted the times for you.
            </span>
          </motion.div>
        )}

        {/* Input hint */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="mt-2 flex items-center gap-2"
        >
          <div className="flex-1 bg-gray-100 rounded-full px-3 py-1.5 flex items-center">
            <span className="text-[9px] text-gray-400">Ask AI to modify your plan...</span>
          </div>
          <div className="w-6 h-6 bg-[#FF6B6B] rounded-full flex items-center justify-center">
            <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13" />
            </svg>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
