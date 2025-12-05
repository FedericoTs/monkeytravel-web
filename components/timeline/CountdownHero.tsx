"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";

interface CountdownHeroProps {
  destination: string;
  startDate: Date;
  tripDays: number;
  activitiesCount: number;
  weatherForecast?: { temp: number; condition: string; icon: string };
  coverImageUrl?: string;
}

interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

export default function CountdownHero({
  destination,
  startDate,
  tripDays,
  activitiesCount,
  weatherForecast,
  coverImageUrl,
}: CountdownHeroProps) {
  const calculateTimeLeft = useCallback((): TimeLeft => {
    const now = new Date();
    const diff = startDate.getTime() - now.getTime();

    if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0 };

    return {
      days: Math.floor(diff / (1000 * 60 * 60 * 24)),
      hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
      minutes: Math.floor((diff / (1000 * 60)) % 60),
      seconds: Math.floor((diff / 1000) % 60),
    };
  }, [startDate]);

  const [timeLeft, setTimeLeft] = useState<TimeLeft>(calculateTimeLeft());
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(calculateTimeLeft());
    }, 1000);

    return () => clearInterval(timer);
  }, [calculateTimeLeft]);

  // Check if trip is starting today or tomorrow
  const isStartingSoon = timeLeft.days === 0 || timeLeft.days === 1;
  const isStartingToday = timeLeft.days === 0 && timeLeft.hours < 24;

  return (
    <div className="relative overflow-hidden rounded-2xl lg:rounded-3xl">
      {/* Background Image with Overlay */}
      <div className="absolute inset-0">
        {coverImageUrl ? (
          <Image
            src={coverImageUrl}
            alt={destination}
            fill
            className="object-cover"
            priority
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-[var(--primary)] via-[var(--primary-dark)] to-[var(--secondary)]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-black/10" />
      </div>

      {/* Content */}
      <div className="relative z-10 px-5 py-8 sm:px-8 sm:py-12 lg:py-16 text-center">
        {/* Pre-trip badge */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/20 backdrop-blur-md border border-white/30 text-white text-sm font-medium mb-5"
        >
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          {isStartingToday
            ? "Your adventure starts today!"
            : isStartingSoon
            ? "Get ready - almost time!"
            : "Your adventure awaits"}
        </motion.div>

        {/* Destination Name */}
        <motion.h2
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold text-white mb-6"
        >
          {destination}
        </motion.h2>

        {/* Countdown Grid */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3, type: "spring" }}
          className="flex items-center justify-center gap-2 sm:gap-3 mb-8"
        >
          <CountdownBox value={mounted ? timeLeft.days : 0} label="Days" />
          <span className="text-white/60 text-xl sm:text-2xl font-light">:</span>
          <CountdownBox value={mounted ? timeLeft.hours : 0} label="Hours" />
          <span className="text-white/60 text-xl sm:text-2xl font-light">:</span>
          <CountdownBox value={mounted ? timeLeft.minutes : 0} label="Mins" />
          <span className="text-white/60 text-xl sm:text-2xl font-light hidden sm:block">:</span>
          <div className="hidden sm:block">
            <CountdownBox value={mounted ? timeLeft.seconds : 0} label="Secs" />
          </div>
        </motion.div>

        {/* Trip Stats */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="flex items-center justify-center flex-wrap gap-3 sm:gap-5 text-white/90"
        >
          {weatherForecast && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-xl sm:text-2xl">{weatherForecast.icon}</span>
                <span className="font-medium text-sm sm:text-base">{weatherForecast.temp}°C</span>
              </div>
              <div className="w-px h-4 bg-white/30" />
            </>
          )}
          <div className="flex items-center gap-1.5">
            <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span className="font-medium text-sm sm:text-base">{tripDays} days</span>
          </div>
          <div className="w-px h-4 bg-white/30" />
          <div className="flex items-center gap-1.5">
            <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <span className="font-medium text-sm sm:text-base">{activitiesCount} activities</span>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

function CountdownBox({ value, label }: { value: number; label: string }) {
  const displayValue = String(value).padStart(2, "0");

  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        <div className="
          w-14 h-14 sm:w-18 sm:h-18 lg:w-20 lg:h-20
          rounded-xl sm:rounded-2xl
          bg-white/10 backdrop-blur-xl
          border border-white/20
          flex items-center justify-center
          shadow-lg
        ">
          <AnimatePresence mode="popLayout">
            <motion.span
              key={value}
              initial={{ rotateX: -90, opacity: 0 }}
              animate={{ rotateX: 0, opacity: 1 }}
              exit={{ rotateX: 90, opacity: 0 }}
              transition={{ duration: 0.3, ease: "easeInOut" }}
              className="
                font-display font-bold
                text-xl sm:text-2xl lg:text-3xl
                text-white
              "
            >
              {displayValue}
            </motion.span>
          </AnimatePresence>
        </div>
      </div>
      <span className="
        mt-1.5 text-[10px] sm:text-xs
        font-medium uppercase tracking-widest
        text-white/70
      ">
        {label}
      </span>
    </div>
  );
}
