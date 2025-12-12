"use client";

import { motion } from "framer-motion";

// Trip showcase card for CTA cascade
interface TripShowcaseProps {
  destination: string;
  country: string;
  flag: string;
  days: number;
  price: string;
  color: string;
  delay: number;
}

function TripShowcase({ destination, country, flag, days, price, color, delay }: TripShowcaseProps) {
  return (
    <div className="absolute inset-0 flex flex-col">
      {/* Hero image area - gradient background */}
      <div
        className="flex-1 relative"
        style={{
          background: `linear-gradient(135deg, ${color}20 0%, ${color}40 50%, ${color}60 100%)`,
        }}
      >
        {/* Decorative pattern */}
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: `radial-gradient(circle at 20% 30%, ${color} 1px, transparent 1px)`,
            backgroundSize: "20px 20px",
          }}
        />

        {/* Destination icon */}
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: delay + 0.2, type: "spring" }}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
        >
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center text-4xl"
            style={{
              background: `linear-gradient(135deg, white 0%, ${color}10 100%)`,
              boxShadow: `0 20px 60px -15px ${color}80`,
            }}
          >
            {flag}
          </div>
        </motion.div>

        {/* Floating stats */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: delay + 0.4 }}
          className="absolute top-16 left-3 px-2 py-1 bg-white/90 backdrop-blur rounded-lg shadow-sm"
        >
          <span className="text-[9px] font-medium" style={{ color }}>📅 {days} days</span>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: delay + 0.5 }}
          className="absolute top-16 right-3 px-2 py-1 bg-white/90 backdrop-blur rounded-lg shadow-sm"
        >
          <span className="text-[9px] font-bold" style={{ color }}>💰 {price}</span>
        </motion.div>
      </div>

      {/* Bottom info */}
      <div className="bg-white p-3">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: delay + 0.3 }}
        >
          <h3 className="text-[14px] font-bold text-gray-900">{destination}</h3>
          <p className="text-[10px] text-gray-500">{country}</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: delay + 0.6 }}
          className="flex items-center justify-between mt-2"
        >
          <div className="flex items-center gap-1">
            <div className="flex -space-x-1">
              {["😊", "🤩", "😎"].map((emoji, i) => (
                <div
                  key={i}
                  className="w-4 h-4 rounded-full bg-gray-100 flex items-center justify-center text-[8px] border border-white"
                >
                  {emoji}
                </div>
              ))}
            </div>
            <span className="text-[8px] text-gray-500">+2.4k travelers</span>
          </div>
          <div className="flex items-center gap-0.5">
            {"★★★★★".split("").map((star, i) => (
              <span key={i} className="text-[8px]" style={{ color }}>
                {star}
              </span>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  );
}

// Different showcase variants for the cascade
const SHOWCASE_VARIANTS = {
  lisbon: {
    destination: "Lisbon",
    country: "Portugal",
    flag: "🇵🇹",
    days: 4,
    price: "$580",
    color: "#FFD93D",
  },
  barcelona: {
    destination: "Barcelona",
    country: "Spain",
    flag: "🇪🇸",
    days: 5,
    price: "$442",
    color: "#FF6B6B",
  },
  porto: {
    destination: "Porto",
    country: "Portugal",
    flag: "🇵🇹",
    days: 3,
    price: "$320",
    color: "#00B4A6",
  },
};

interface CTAShowcaseScreenProps {
  variant?: keyof typeof SHOWCASE_VARIANTS;
  delay?: number;
}

export default function CTAShowcaseScreen({
  variant = "barcelona",
  delay = 0,
}: CTAShowcaseScreenProps) {
  const showcase = SHOWCASE_VARIANTS[variant];

  return (
    <TripShowcase
      {...showcase}
      delay={delay}
    />
  );
}
