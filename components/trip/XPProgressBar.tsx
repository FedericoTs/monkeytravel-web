"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Flame, Zap, Trophy, Star } from "lucide-react";
import type { AchievementId, XpGainEvent } from "@/types/timeline";
import { ACHIEVEMENTS, STREAK_MULTIPLIERS } from "@/types/timeline";

interface XPProgressBarProps {
  totalXp: number;
  maxXp: number;
  currentStreak: number;
  todayProgress: { completed: number; total: number };
  recentXpGain?: XpGainEvent | null;
  className?: string;
}

// Level thresholds for the XP bar
const LEVELS = [
  { level: 1, xpRequired: 0, name: "Traveler" },
  { level: 2, xpRequired: 100, name: "Explorer" },
  { level: 3, xpRequired: 250, name: "Adventurer" },
  { level: 4, xpRequired: 500, name: "Voyager" },
  { level: 5, xpRequired: 800, name: "Globetrotter" },
  { level: 6, xpRequired: 1200, name: "Wayfarer" },
  { level: 7, xpRequired: 1700, name: "Wanderer" },
  { level: 8, xpRequired: 2300, name: "Pathfinder" },
  { level: 9, xpRequired: 3000, name: "Pioneer" },
  { level: 10, xpRequired: 4000, name: "Legend" },
];

function getCurrentLevel(xp: number) {
  let currentLevel = LEVELS[0];
  let nextLevel = LEVELS[1];

  for (let i = LEVELS.length - 1; i >= 0; i--) {
    if (xp >= LEVELS[i].xpRequired) {
      currentLevel = LEVELS[i];
      nextLevel = LEVELS[i + 1] || LEVELS[i];
      break;
    }
  }

  const xpInCurrentLevel = xp - currentLevel.xpRequired;
  const xpForNextLevel = nextLevel.xpRequired - currentLevel.xpRequired;
  const progress = xpForNextLevel > 0 ? (xpInCurrentLevel / xpForNextLevel) * 100 : 100;

  return { currentLevel, nextLevel, progress, xpInCurrentLevel, xpForNextLevel };
}

export default function XPProgressBar({
  totalXp,
  maxXp,
  currentStreak,
  todayProgress,
  recentXpGain,
  className = "",
}: XPProgressBarProps) {
  const [showXpAnimation, setShowXpAnimation] = useState(false);
  const [animatedXp, setAnimatedXp] = useState(totalXp);
  const levelInfo = getCurrentLevel(animatedXp);

  // Animate XP changes
  useEffect(() => {
    if (recentXpGain) {
      setShowXpAnimation(true);
      // Animate the XP counter
      const startXp = animatedXp;
      const endXp = totalXp;
      const duration = 800;
      const startTime = Date.now();

      const animate = () => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        // Easing function for smooth animation
        const eased = 1 - Math.pow(1 - progress, 3);
        setAnimatedXp(Math.round(startXp + (endXp - startXp) * eased));

        if (progress < 1) {
          requestAnimationFrame(animate);
        }
      };

      requestAnimationFrame(animate);

      const timer = setTimeout(() => setShowXpAnimation(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [recentXpGain, totalXp]);

  const streakMultiplier = STREAK_MULTIPLIERS[Math.min(currentStreak, 6)] || 2;
  const hasActiveStreak = currentStreak >= 3;

  return (
    <div className={`bg-white rounded-xl border border-slate-200 p-4 shadow-sm ${className}`}>
      {/* Level & XP Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          {/* Level Badge */}
          <div className="relative">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[var(--primary)] to-[var(--primary)]/70 flex items-center justify-center shadow-lg">
              <span className="text-white font-bold text-lg">{levelInfo.currentLevel.level}</span>
            </div>
            {/* Glow effect on level up */}
            <motion.div
              className="absolute inset-0 rounded-full bg-[var(--accent)] opacity-0"
              animate={showXpAnimation ? { opacity: [0, 0.5, 0], scale: [1, 1.3, 1] } : {}}
              transition={{ duration: 0.6 }}
            />
          </div>

          <div>
            <div className="font-semibold text-slate-900">{levelInfo.currentLevel.name}</div>
            <div className="text-sm text-slate-500">
              <motion.span
                key={animatedXp}
                initial={{ scale: 1 }}
                animate={showXpAnimation ? { scale: [1, 1.2, 1] } : {}}
                className="font-medium text-[var(--primary)]"
              >
                {animatedXp.toLocaleString()} XP
              </motion.span>
              {levelInfo.nextLevel.level !== levelInfo.currentLevel.level && (
                <span> / {levelInfo.nextLevel.xpRequired.toLocaleString()} XP</span>
              )}
            </div>
          </div>
        </div>

        {/* Streak Counter */}
        <div className="flex items-center gap-2">
          {currentStreak > 0 && (
            <motion.div
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full ${
                hasActiveStreak
                  ? "bg-gradient-to-r from-orange-500 to-red-500 text-white"
                  : "bg-orange-100 text-orange-700"
              }`}
              animate={hasActiveStreak ? { scale: [1, 1.05, 1] } : {}}
              transition={{ repeat: Infinity, duration: 2 }}
            >
              <Flame className="w-4 h-4" />
              <span className="font-bold">{currentStreak}</span>
              {hasActiveStreak && (
                <span className="text-xs opacity-90">×{streakMultiplier}</span>
              )}
            </motion.div>
          )}
        </div>
      </div>

      {/* XP Progress Bar */}
      <div className="relative h-3 bg-slate-100 rounded-full overflow-hidden mb-3">
        <motion.div
          className="absolute inset-y-0 left-0 bg-gradient-to-r from-[var(--primary)] to-[var(--accent)] rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${levelInfo.progress}%` }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
        {/* Shimmer effect on XP gain */}
        <AnimatePresence>
          {showXpAnimation && (
            <motion.div
              className="absolute inset-0 bg-gradient-to-r from-transparent via-white/50 to-transparent"
              initial={{ x: "-100%" }}
              animate={{ x: "100%" }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.6 }}
            />
          )}
        </AnimatePresence>
      </div>

      {/* Today's Progress */}
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-4">
          {/* Activities completed today */}
          <div className="flex items-center gap-1.5 text-slate-600">
            <Star className="w-4 h-4 text-[var(--accent)]" />
            <span>
              <span className="font-medium text-slate-900">{todayProgress.completed}</span>
              /{todayProgress.total} today
            </span>
          </div>

          {/* Next level hint */}
          {levelInfo.nextLevel.level !== levelInfo.currentLevel.level && (
            <div className="flex items-center gap-1.5 text-slate-500">
              <Zap className="w-4 h-4" />
              <span>
                {levelInfo.xpForNextLevel - levelInfo.xpInCurrentLevel} XP to{" "}
                <span className="font-medium">{levelInfo.nextLevel.name}</span>
              </span>
            </div>
          )}
        </div>
      </div>

      {/* XP Gain Animation Popup */}
      <AnimatePresence>
        {showXpAnimation && recentXpGain && (
          <motion.div
            className="absolute top-0 right-4 transform -translate-y-full"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            <div className="bg-[var(--accent)] text-slate-900 px-3 py-1.5 rounded-full font-bold shadow-lg flex items-center gap-1">
              +{recentXpGain.totalXp} XP
              {recentXpGain.streakMultiplier > 1 && (
                <span className="text-xs opacity-80">
                  (×{recentXpGain.streakMultiplier})
                </span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Achievement Toast Component
interface AchievementToastProps {
  achievementId: AchievementId;
  onDismiss: () => void;
}

export function AchievementToast({ achievementId, onDismiss }: AchievementToastProps) {
  const achievement = ACHIEVEMENTS[achievementId];

  useEffect(() => {
    const timer = setTimeout(onDismiss, 4000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  const rarityColors = {
    common: "from-slate-500 to-slate-600",
    rare: "from-blue-500 to-blue-600",
    epic: "from-purple-500 to-purple-600",
    legendary: "from-amber-500 to-orange-500",
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 50, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -20, scale: 0.9 }}
      className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50"
    >
      <div
        className={`bg-gradient-to-r ${rarityColors[achievement.rarity]} text-white px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-4`}
      >
        {/* Achievement Icon */}
        <motion.div
          className="w-14 h-14 bg-white/20 rounded-xl flex items-center justify-center text-3xl"
          animate={{ rotate: [0, -10, 10, -5, 5, 0] }}
          transition={{ duration: 0.5 }}
        >
          {achievement.icon}
        </motion.div>

        <div>
          <div className="flex items-center gap-2">
            <Trophy className="w-4 h-4" />
            <span className="text-xs uppercase tracking-wider opacity-80">
              {achievement.rarity} Achievement
            </span>
          </div>
          <div className="font-bold text-lg">{achievement.name}</div>
          <div className="text-sm opacity-90">{achievement.description}</div>
          <div className="text-xs mt-1 font-medium">+{achievement.xpBonus} XP</div>
        </div>
      </div>
    </motion.div>
  );
}
