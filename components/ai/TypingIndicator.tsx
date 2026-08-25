"use client";

import { motion } from "framer-motion";

interface TypingIndicatorProps {
  className?: string;
  text?: string;
}

export default function TypingIndicator({
  className = "",
  text = "Thinking...",
}: TypingIndicatorProps) {
  const dotVariants = {
    initial: { y: 0, opacity: 0.5 },
    animate: {
      y: [-0, -6, 0],
      opacity: [0.5, 1, 0.5],
      transition: {
        duration: 0.6,
        repeat: Infinity,
        ease: "easeInOut" as const,
      },
    },
  };

  return (
    <div className={`flex justify-start ${className}`}>
      <div className="bg-white rounded-2xl rounded-bl-md px-4 py-3 shadow-sm border border-slate-100">
        <div className="flex items-center gap-2.5">
          {/* Wave dots */}
          <div className="flex items-center gap-1">
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                className="w-2 h-2 bg-[var(--primary)] rounded-full"
                variants={dotVariants}
                initial="initial"
                animate="animate"
                style={{
                  animationDelay: `${i * 0.15}s`,
                }}
                transition={{
                  delay: i * 0.15,
                }}
              />
            ))}
          </div>

          {/* Text */}
          <span className="text-xs text-slate-400">{text}</span>
        </div>
      </div>
    </div>
  );
}

// Compact inline version for smaller contexts
export function TypingIndicatorCompact({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-1 ${className}`}>
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="w-1.5 h-1.5 bg-slate-400 rounded-full"
          animate={{
            y: [0, -4, 0],
            opacity: [0.4, 1, 0.4],
          }}
          transition={{
            duration: 0.6,
            repeat: Infinity,
            ease: "easeInOut",
            delay: i * 0.15,
          }}
        />
      ))}
    </div>
  );
}
