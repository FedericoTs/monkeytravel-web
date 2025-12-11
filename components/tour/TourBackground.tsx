"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import { kenBurnsVariants, crossfadeVariants, SMOOTH_EASE } from "./animations";
import { useReducedMotion } from "./hooks/useReducedMotion";

// Curated high-quality background images (from your Pexels collection)
const BACKGROUND_IMAGES: Record<string, string> = {
  barcelona: "https://images.pexels.com/photos/1388030/pexels-photo-1388030.jpeg?auto=compress&cs=tinysrgb&w=1920&h=1080&fit=crop",
  tokyo: "https://images.pexels.com/photos/2614818/pexels-photo-2614818.jpeg?auto=compress&cs=tinysrgb&w=1920&h=1080&fit=crop",
  santorini: "https://images.pexels.com/photos/1010657/pexels-photo-1010657.jpeg?auto=compress&cs=tinysrgb&w=1920&h=1080&fit=crop",
  paris: "https://images.pexels.com/photos/338515/pexels-photo-338515.jpeg?auto=compress&cs=tinysrgb&w=1920&h=1080&fit=crop",
  lisbon: "https://images.pexels.com/photos/1534560/pexels-photo-1534560.jpeg?auto=compress&cs=tinysrgb&w=1920&h=1080&fit=crop",
  porto: "https://images.pexels.com/photos/2549018/pexels-photo-2549018.jpeg?auto=compress&cs=tinysrgb&w=1920&h=1080&fit=crop",
  aerial: "https://images.pexels.com/photos/1680140/pexels-photo-1680140.jpeg?auto=compress&cs=tinysrgb&w=1920&h=1080&fit=crop",
  clouds: "https://images.pexels.com/photos/1906658/pexels-photo-1906658.jpeg?auto=compress&cs=tinysrgb&w=1920&h=1080&fit=crop",
};

// Slide to background mapping
const SLIDE_BACKGROUNDS: Record<number, string[]> = {
  0: ["barcelona"], // Slide 1: Dream destination
  1: ["barcelona"], // Slide 2: AI itinerary
  2: ["aerial"], // Slide 3: Map view
  3: ["clouds"], // Slide 4: Templates
  4: ["barcelona", "tokyo", "santorini", "paris"], // Slide 5: Montage
};

interface TourBackgroundProps {
  slideIndex: number;
  className?: string;
}

export default function TourBackground({ slideIndex, className = "" }: TourBackgroundProps) {
  const prefersReducedMotion = useReducedMotion();
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [imageLoaded, setImageLoaded] = useState(false);

  const backgroundKeys = SLIDE_BACKGROUNDS[slideIndex] || ["barcelona"];
  const isMontageSLide = backgroundKeys.length > 1;

  // Montage rotation for final slide
  useEffect(() => {
    if (!isMontageSLide) {
      setCurrentImageIndex(0);
      return;
    }

    const interval = setInterval(() => {
      setCurrentImageIndex((prev) => (prev + 1) % backgroundKeys.length);
    }, 4000); // Change every 4 seconds

    return () => clearInterval(interval);
  }, [isMontageSLide, backgroundKeys.length]);

  const currentKey = backgroundKeys[currentImageIndex];
  const imageUrl = BACKGROUND_IMAGES[currentKey];

  return (
    <div className={`absolute inset-0 overflow-hidden ${className}`}>
      {/* Brand gradient base - visible while image loads */}
      <div
        className="absolute inset-0"
        style={{
          background: `
            linear-gradient(
              135deg,
              #1a1a2e 0%,
              #16213e 25%,
              #0f3460 50%,
              #1a1a2e 75%,
              #16213e 100%
            )
          `,
        }}
      />

      {/* Animated brand color orbs */}
      <div className="absolute inset-0 overflow-hidden">
        <motion.div
          animate={{
            x: [0, 30, 0],
            y: [0, -20, 0],
            scale: [1, 1.1, 1],
          }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -top-1/4 -left-1/4 w-1/2 h-1/2 rounded-full opacity-30"
          style={{
            background: "radial-gradient(circle, rgba(255, 107, 107, 0.4) 0%, transparent 70%)",
            filter: "blur(60px)",
          }}
        />
        <motion.div
          animate={{
            x: [0, -20, 0],
            y: [0, 30, 0],
            scale: [1, 1.15, 1],
          }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 1 }}
          className="absolute -bottom-1/4 -right-1/4 w-1/2 h-1/2 rounded-full opacity-25"
          style={{
            background: "radial-gradient(circle, rgba(0, 180, 166, 0.4) 0%, transparent 70%)",
            filter: "blur(60px)",
          }}
        />
        <motion.div
          animate={{
            x: [0, 15, 0],
            y: [0, -15, 0],
            scale: [1, 1.05, 1],
          }}
          transition={{ duration: 12, repeat: Infinity, ease: "easeInOut", delay: 2 }}
          className="absolute top-1/3 right-1/4 w-1/3 h-1/3 rounded-full opacity-20"
          style={{
            background: "radial-gradient(circle, rgba(255, 217, 61, 0.35) 0%, transparent 70%)",
            filter: "blur(40px)",
          }}
        />
      </div>

      {/* Background Image with Ken Burns */}
      <AnimatePresence mode="wait">
        <motion.div
          key={`${slideIndex}-${currentKey}`}
          variants={crossfadeVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="absolute inset-0"
        >
          <motion.div
            variants={prefersReducedMotion ? undefined : kenBurnsVariants}
            initial="initial"
            animate="animate"
            className="absolute inset-0 w-[120%] h-[120%] -left-[10%] -top-[10%]"
          >
            <Image
              src={imageUrl}
              alt="Destination background"
              fill
              priority={slideIndex === 0}
              className={`object-cover transition-opacity duration-700 ${
                imageLoaded ? "opacity-100" : "opacity-0"
              }`}
              onLoad={() => setImageLoaded(true)}
              sizes="100vw"
              quality={85}
            />
          </motion.div>
        </motion.div>
      </AnimatePresence>

      {/* Cinematic Gradient Overlay - lighter to show more image */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `
            linear-gradient(
              180deg,
              rgba(0, 0, 0, 0.4) 0%,
              rgba(0, 0, 0, 0.15) 30%,
              rgba(0, 0, 0, 0.1) 50%,
              rgba(0, 0, 0, 0.2) 80%,
              rgba(0, 0, 0, 0.5) 100%
            )
          `,
        }}
      />

      {/* Brand color tint overlay */}
      <div
        className="absolute inset-0 pointer-events-none mix-blend-soft-light"
        style={{
          background: `
            radial-gradient(
              ellipse at 30% 20%,
              rgba(255, 107, 107, 0.2) 0%,
              transparent 50%
            ),
            radial-gradient(
              ellipse at 70% 80%,
              rgba(255, 217, 61, 0.15) 0%,
              transparent 50%
            ),
            radial-gradient(
              ellipse at 50% 50%,
              rgba(0, 180, 166, 0.1) 0%,
              transparent 60%
            )
          `,
        }}
      />

      {/* Vignette effect - softer */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          boxShadow: "inset 0 0 120px rgba(0, 0, 0, 0.3)",
        }}
      />

      {/* Subtle noise texture for premium feel */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.02]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
        }}
      />
    </div>
  );
}
