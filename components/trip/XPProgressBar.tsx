"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Zap, Trophy } from "lucide-react";
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
  const [showDayComplete, setShowDayComplete] = useState(false);
  const levelInfo = getCurrentLevel(animatedXp);

  // Calculate day progress percentage
  const dayProgressPercent = todayProgress.total > 0
    ? (todayProgress.completed / todayProgress.total) * 100
    : 0;
  const isDayComplete = todayProgress.completed === todayProgress.total && todayProgress.total > 0;

  // Show day complete celebration when all activities done
  useEffect(() => {
    if (isDayComplete && todayProgress.completed > 0) {
      setShowDayComplete(true);
      const timer = setTimeout(() => setShowDayComplete(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [isDayComplete, todayProgress.completed]);

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
    <div className={`bg-white rounded-xl border border-slate-200 p-4 shadow-sm relative overflow-hidden ${className}`}>
      {/* Day Complete Celebration Overlay */}
      <AnimatePresence>
        {showDayComplete && (
          <motion.div
            className="absolute inset-0 bg-gradient-to-r from-yellow-400/20 via-amber-400/30 to-yellow-400/20 z-10 pointer-events-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {/* Floating bananas animation - bunch of bananas */}
            <motion.div
              className="absolute inset-0 flex items-center justify-center gap-1"
              initial={{ scale: 0 }}
              animate={{ scale: [0, 1.2, 1] }}
              transition={{ duration: 0.5 }}
            >
              <motion.span
                className="text-5xl"
                animate={{ rotate: [-15, 0, -15] }}
                transition={{ duration: 0.6, delay: 0.2 }}
              >
                🍌
              </motion.span>
              <motion.span
                className="text-6xl"
                animate={{ y: [0, -5, 0] }}
                transition={{ duration: 0.5, delay: 0.1 }}
              >
                🍌
              </motion.span>
              <motion.span
                className="text-5xl"
                animate={{ rotate: [15, 0, 15] }}
                transition={{ duration: 0.6, delay: 0.2 }}
              >
                🍌
              </motion.span>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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

        {/* Banana Streak Counter 🍌 */}
        <div className="flex items-center gap-2">
          {currentStreak > 0 && (
            <motion.div
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full ${
                hasActiveStreak
                  ? "bg-gradient-to-r from-yellow-400 to-amber-500 text-slate-900"
                  : "bg-yellow-100 text-yellow-800"
              }`}
              animate={hasActiveStreak ? { scale: [1, 1.05, 1] } : {}}
              transition={{ repeat: Infinity, duration: 2 }}
            >
              <span className="text-lg">🍌</span>
              <span className="font-bold">{currentStreak}</span>
              {hasActiveStreak && (
                <span className="text-xs opacity-80 font-medium">×{streakMultiplier}</span>
              )}
            </motion.div>
          )}
        </div>
      </div>

      {/* Combined Progress Bar - Day Progress (main) + XP hint */}
      <div className="relative mb-3">
        {/* Day Progress Label */}
        <div className="flex items-center justify-between text-xs mb-1.5">
          <span className="text-slate-600 font-medium">Today&apos;s Progress</span>
          <span className={`font-bold ${isDayComplete ? "text-emerald-600" : "text-slate-700"}`}>
            {todayProgress.completed}/{todayProgress.total} activities
            {isDayComplete && " ✓"}
          </span>
        </div>

        {/* Progress Bar */}
        <div className="relative h-4 bg-slate-100 rounded-full overflow-hidden">
          {/* Day Progress (main fill) */}
          <motion.div
            className={`absolute inset-y-0 left-0 rounded-full ${
              isDayComplete
                ? "bg-gradient-to-r from-emerald-400 to-emerald-500"
                : "bg-gradient-to-r from-[var(--primary)] to-[var(--accent)]"
            }`}
            initial={{ width: 0 }}
            animate={{ width: `${dayProgressPercent}%` }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          />

          {/* XP Progress overlay (subtle indicator) */}
          <motion.div
            className="absolute inset-y-0 left-0 bg-white/30 rounded-full"
            style={{ width: `${Math.min(levelInfo.progress, dayProgressPercent)}%` }}
          />

          {/* Segment markers */}
          {todayProgress.total > 1 && todayProgress.total <= 10 && (
            <div className="absolute inset-0 flex">
              {Array.from({ length: todayProgress.total - 1 }).map((_, i) => (
                <div
                  key={i}
                  className="flex-1 border-r border-white/40"
                />
              ))}
              <div className="flex-1" />
            </div>
          )}

          {/* Shimmer effect on completion */}
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

          {/* Banana icon at progress point */}
          {dayProgressPercent > 0 && dayProgressPercent < 100 && (
            <motion.div
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 text-lg"
              style={{ left: `${dayProgressPercent}%` }}
              animate={{ scale: [1, 1.1, 1] }}
              transition={{ repeat: Infinity, duration: 1.5 }}
            >
              🍌
            </motion.div>
          )}

          {/* Bunch of bananas at end when complete */}
          {isDayComplete && (
            <motion.div
              className="absolute right-1 top-1/2 -translate-y-1/2 flex"
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 200 }}
            >
              <span className="text-sm">🍌🍌🍌</span>
            </motion.div>
          )}
        </div>
      </div>

      {/* XP to Next Level */}
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-1.5 text-slate-500">
          <Zap className="w-4 h-4" />
          {levelInfo.nextLevel.level !== levelInfo.currentLevel.level ? (
            <span>
              {levelInfo.xpForNextLevel - levelInfo.xpInCurrentLevel} XP to{" "}
              <span className="font-medium text-slate-700">{levelInfo.nextLevel.name}</span>
            </span>
          ) : (
            <span className="font-medium text-emerald-600">Max Level!</span>
          )}
        </div>

        {/* Day complete badge */}
        {isDayComplete && (
          <motion.div
            className="flex items-center gap-1 text-emerald-600 font-medium"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
          >
            <span>Day Complete!</span>
            <span className="text-lg">🎉</span>
          </motion.div>
        )}
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

  // Auto-dismiss after 5 seconds
  useEffect(() => {
    const timer = setTimeout(onDismiss, 5000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  const rarityColors = {
    common: "from-slate-500 to-slate-600",
    rare: "from-blue-500 to-blue-600",
    epic: "from-purple-500 to-purple-600",
    legendary: "from-amber-500 to-orange-500",
  };

  // Special icon for Day Master - bunch of bananas
  const displayIcon = achievementId === "day_master" ? "🍌🍌🍌" : achievement.icon;

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
          {displayIcon}
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

        {/* Close button */}
        <button
          onClick={onDismiss}
          className="absolute top-2 right-2 w-6 h-6 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 transition-colors"
        >
          <span className="text-white text-sm">×</span>
        </button>
      </div>
    </motion.div>
  );
}
