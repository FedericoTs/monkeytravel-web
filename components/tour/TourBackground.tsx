"use client";

import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import { useReducedMotion } from "./hooks/useReducedMotion";

// Stunning destination images - each slide gets a unique image, no repeats
interface DestinationImage {
  id: string;
  url: string;
  name: string;
  // Ken Burns animation direction
  animation: "panLeft" | "panRight" | "panUp" | "panDown" | "zoomIn" | "zoomOut" | "diagonalTL" | "diagonalBR";
}

const DESTINATION_IMAGES: DestinationImage[] = [
  // Slide 1: Dream Destination - Maldives aerial paradise
  {
    id: "maldives",
    url: "https://images.pexels.com/photos/1287460/pexels-photo-1287460.jpeg?auto=compress&cs=tinysrgb&w=1920&h=1080&fit=crop",
    name: "Maldives",
    animation: "panRight",
  },
  // Slide 2: AI Itinerary - Bali rice terraces
  {
    id: "bali",
    url: "https://images.pexels.com/photos/2166559/pexels-photo-2166559.jpeg?auto=compress&cs=tinysrgb&w=1920&h=1080&fit=crop",
    name: "Bali",
    animation: "panUp",
  },
  // Slide 3: Map - London skyline
  {
    id: "london",
    url: "https://images.pexels.com/photos/672532/pexels-photo-672532.jpeg?auto=compress&cs=tinysrgb&w=1920&h=1080&fit=crop",
    name: "London",
    animation: "panLeft",
  },
  // Slide 4: Templates - Caribbean beach sunset
  {
    id: "caribbean",
    url: "https://images.pexels.com/photos/1032650/pexels-photo-1032650.jpeg?auto=compress&cs=tinysrgb&w=1920&h=1080&fit=crop",
    name: "Caribbean",
    animation: "zoomIn",
  },
  // Slide 5 montage images - Mexico, Jungle, Beach aerial, Santorini
  {
    id: "mexico",
    url: "https://images.pexels.com/photos/3225529/pexels-photo-3225529.jpeg?auto=compress&cs=tinysrgb&w=1920&h=1080&fit=crop",
    name: "Mexico Cenote",
    animation: "diagonalTL",
  },
  {
    id: "jungle",
    url: "https://images.pexels.com/photos/2166711/pexels-photo-2166711.jpeg?auto=compress&cs=tinysrgb&w=1920&h=1080&fit=crop",
    name: "Jungle Waterfall",
    animation: "panDown",
  },
  {
    id: "beach-aerial",
    url: "https://images.pexels.com/photos/1680140/pexels-photo-1680140.jpeg?auto=compress&cs=tinysrgb&w=1920&h=1080&fit=crop",
    name: "Beach Aerial",
    animation: "zoomOut",
  },
  {
    id: "santorini",
    url: "https://images.pexels.com/photos/1010657/pexels-photo-1010657.jpeg?auto=compress&cs=tinysrgb&w=1920&h=1080&fit=crop",
    name: "Santorini",
    animation: "diagonalBR",
  },
];

// Slide to image index mapping - ensures no repeats
const SLIDE_TO_IMAGE: Record<number, number[]> = {
  0: [0],           // Slide 1: Maldives
  1: [1],           // Slide 2: Bali
  2: [2],           // Slide 3: London
  3: [3],           // Slide 4: Caribbean
  4: [4, 5, 6, 7],  // Slide 5: Montage (Mexico, Jungle, Beach, Santorini)
};

// Ken Burns animation config
const KENBURNS_DURATION = 12;
const KENBURNS_SCALE = 1.15;

interface KenBurnsConfig {
  initialScale: number;
  animateScale: number;
  initialX: string;
  animateX: string;
  initialY: string;
  animateY: string;
}

const getKenBurnsConfig = (direction: DestinationImage["animation"]): KenBurnsConfig => {
  const s = KENBURNS_SCALE; // default scale
  const configs: Record<string, KenBurnsConfig> = {
    panLeft: { initialScale: s, animateScale: s, initialX: "5%", animateX: "-5%", initialY: "0%", animateY: "0%" },
    panRight: { initialScale: s, animateScale: s, initialX: "-5%", animateX: "5%", initialY: "0%", animateY: "0%" },
    panUp: { initialScale: s, animateScale: s, initialX: "0%", animateX: "0%", initialY: "5%", animateY: "-5%" },
    panDown: { initialScale: s, animateScale: s, initialX: "0%", animateX: "0%", initialY: "-5%", animateY: "5%" },
    zoomIn: { initialScale: 1.0, animateScale: 1.2, initialX: "0%", animateX: "0%", initialY: "0%", animateY: "0%" },
    zoomOut: { initialScale: 1.25, animateScale: 1.05, initialX: "0%", animateX: "0%", initialY: "0%", animateY: "0%" },
    diagonalTL: { initialScale: s, animateScale: s, initialX: "5%", animateX: "-3%", initialY: "5%", animateY: "-3%" },
    diagonalBR: { initialScale: s, animateScale: s, initialX: "-5%", animateX: "3%", initialY: "-5%", animateY: "3%" },
  };
  return configs[direction] || configs.zoomIn;
};

// Crossfade variants with dynamic cuts
const crossfadeVariants = {
  hidden: {
    opacity: 0,
    scale: 1.05,
  },
  visible: {
    opacity: 1,
    scale: 1,
    transition: {
      duration: 1.2,
      ease: [0.25, 0.1, 0.25, 1.0] as [number, number, number, number],
    },
  },
  exit: {
    opacity: 0,
    scale: 0.98,
    transition: {
      duration: 0.8,
      ease: [0.25, 0.1, 0.25, 1.0] as [number, number, number, number],
    },
  },
};

interface TourBackgroundProps {
  slideIndex: number;
  className?: string;
}

export default function TourBackground({ slideIndex, className = "" }: TourBackgroundProps) {
  const prefersReducedMotion = useReducedMotion();
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [loadedImages, setLoadedImages] = useState<Set<string>>(new Set());

  const imageIndices = SLIDE_TO_IMAGE[slideIndex] || [0];
  const isMontageSLide = imageIndices.length > 1;

  // Montage rotation for final slide - cycle through different destinations
  useEffect(() => {
    if (!isMontageSLide) {
      setCurrentImageIndex(0);
      return;
    }

    const interval = setInterval(() => {
      setCurrentImageIndex((prev) => (prev + 1) % imageIndices.length);
    }, 3500); // Slightly faster for dynamic feel

    return () => clearInterval(interval);
  }, [isMontageSLide, imageIndices.length]);

  const currentDestination = useMemo(() => {
    const idx = imageIndices[currentImageIndex];
    return DESTINATION_IMAGES[idx];
  }, [imageIndices, currentImageIndex]);

  const kenBurnsConfig = useMemo(() => {
    return getKenBurnsConfig(currentDestination.animation);
  }, [currentDestination.animation]);

  const handleImageLoad = (id: string) => {
    setLoadedImages((prev) => new Set(prev).add(id));
  };

  const isCurrentImageLoaded = loadedImages.has(currentDestination.id);

  return (
    <div className={`absolute inset-0 overflow-hidden ${className}`}>
      {/* Warm gradient base - visible while images load */}
      <div
        className="absolute inset-0"
        style={{
          background: `
            linear-gradient(
              135deg,
              var(--background-warm, #FFF5EB) 0%,
              var(--background, #FFFAF5) 50%,
              var(--background-warm, #FFF5EB) 100%
            )
          `,
        }}
      />

      {/* Subtle animated brand color orbs */}
      <div className="absolute inset-0 overflow-hidden">
        <motion.div
          animate={prefersReducedMotion ? {} : {
            x: [0, 30, 0],
            y: [0, -20, 0],
            scale: [1, 1.1, 1],
          }}
          transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -top-1/4 -left-1/4 w-2/3 h-2/3 rounded-full"
          style={{
            background: "radial-gradient(circle, rgba(255, 107, 107, 0.08) 0%, transparent 60%)",
            filter: "blur(100px)",
          }}
        />
        <motion.div
          animate={prefersReducedMotion ? {} : {
            x: [0, -25, 0],
            y: [0, 30, 0],
            scale: [1, 1.15, 1],
          }}
          transition={{ duration: 18, repeat: Infinity, ease: "easeInOut", delay: 2 }}
          className="absolute -bottom-1/4 -right-1/4 w-2/3 h-2/3 rounded-full"
          style={{
            background: "radial-gradient(circle, rgba(0, 180, 166, 0.06) 0%, transparent 60%)",
            filter: "blur(100px)",
          }}
        />
      </div>

      {/* Background Image with Ken Burns Effect */}
      <AnimatePresence mode="wait">
        <motion.div
          key={`${slideIndex}-${currentDestination.id}`}
          variants={crossfadeVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="absolute inset-0"
        >
          {/* Ken Burns container - slightly larger to allow panning */}
          <motion.div
            initial={prefersReducedMotion ? { scale: 1 } : {
              scale: kenBurnsConfig.initialScale,
              x: kenBurnsConfig.initialX,
              y: kenBurnsConfig.initialY,
            }}
            animate={prefersReducedMotion ? { scale: 1 } : {
              scale: kenBurnsConfig.animateScale,
              x: kenBurnsConfig.animateX,
              y: kenBurnsConfig.animateY,
            }}
            transition={{ duration: KENBURNS_DURATION, ease: "linear" }}
            className="absolute inset-[-15%] w-[130%] h-[130%]"
          >
            <Image
              src={currentDestination.url}
              alt={`${currentDestination.name} destination`}
              fill
              priority={slideIndex <= 1}
              className={`object-cover transition-opacity duration-1000 ${
                isCurrentImageLoaded ? "opacity-100" : "opacity-0"
              }`}
              onLoad={() => handleImageLoad(currentDestination.id)}
              sizes="100vw"
              quality={90}
            />
          </motion.div>
        </motion.div>
      </AnimatePresence>

      {/* iOS-style soft overlay - gentle gradient for readability without heaviness */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `
            linear-gradient(
              180deg,
              rgba(0, 0, 0, 0.15) 0%,
              rgba(0, 0, 0, 0.02) 30%,
              transparent 50%,
              rgba(0, 0, 0, 0.05) 70%,
              rgba(0, 0, 0, 0.25) 100%
            )
          `,
        }}
      />

      {/* Soft blur layer for premium feel - applied to edges only */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `
            radial-gradient(
              ellipse 120% 100% at 50% 50%,
              transparent 40%,
              rgba(0, 0, 0, 0.08) 100%
            )
          `,
        }}
      />

      {/* Subtle vignette - softer iOS style */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          boxShadow: "inset 0 0 100px rgba(0, 0, 0, 0.1)",
        }}
      />

      {/* Film grain texture for cinematic feel */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.015]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
        }}
      />

      {/* Destination label - subtle badge in corner */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5, duration: 0.6 }}
        className="absolute bottom-6 right-6 z-20"
      >
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/20 backdrop-blur-md border border-white/10">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
          <span className="text-xs text-white/70 font-medium tracking-wide">
            {currentDestination.name}
          </span>
        </div>
      </motion.div>
    </div>
  );
}
